import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';


interface ConsumerProps extends StackProps {
  ecrRepository: ecr.Repository,
  fargateServiceTest: ecsPatterns.ApplicationLoadBalancedFargateService,
  fargateServiceProd: ecsPatterns.ApplicationLoadBalancedFargateService,
}

export class PipelineCdkStack extends Stack {
  constructor(scope: Construct, id: string, props: ConsumerProps) {
    super(scope, id, props);

    // Define a CodePipeline source action using GitHub
    const sourceOutput = new codepipeline.Artifact();
    const unitTestOutput = new codepipeline.Artifact();
    const dockerBuildOutput = new codepipeline.Artifact();

    const signerARNParameter = new ssm.StringParameter(this, 'SignerARNParam', {
      parameterName: 'signer-profile-arn',
      stringValue: 'arn:aws:signer:us-east-1:471112945472:/signing-profiles/ecr_signer_profile',
    });

    const signerParameterPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [signerARNParameter.parameterArn],
      actions: ['ssm:GetParametersByPath', 'ssm:GetParameters'],
    });

    const signerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        'signer:PutSigningProfile',
        'signer:SignPayload',
        'signer:GetRevocationStatus',
      ],
    });



    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: 'rwangnet', // Replace with your GitHub username
      repo: 'CICD_Workshop',        // Replace with your repository name
      branch: 'main',                // Replace with your branch
      oauthToken: cdk.SecretValue.secretsManager('github-token', { jsonField: 'github-token' }), // Replace with your secret name
      output: sourceOutput,
    });


    const codeBuild = new codebuild.PipelineProject(this, 'CodeBuild', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec_test.yml'),
    });

    const build = new codepipeline_actions.CodeBuildAction({
      actionName: 'Unit-Test',
      project: codeBuild,
      input: sourceOutput,
      outputs: [unitTestOutput],
    });

    const dockerBuild = new codebuild.PipelineProject(this, 'DockerBuild', {
      environmentVariables: {
        IMAGE_TAG: { value: 'latest' },
        IMAGE_REPO_URI: { value: props.ecrRepository.repositoryUri },
        AWS_DEFAULT_REGION: { value: process.env.CDK_DEFAULT_REGION },
      },
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec_docker.yml'),
    });

    const dockerBuildRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:GetRepositoryPolicy',
        'ecr:DescribeRepositories',
        'ecr:ListImages',
        'ecr:DescribeImages',
        'ecr:BatchGetImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:PutImage',
      ],
    });

    dockerBuild.addToRolePolicy(dockerBuildRolePolicy);
    dockerBuild.addToRolePolicy(signerParameterPolicy);
    dockerBuild.addToRolePolicy(signerPolicy);


    const docker = new codepipeline_actions.CodeBuildAction({
      actionName: 'Docker-Build',
      project: dockerBuild,
      input: sourceOutput,
      outputs: [dockerBuildOutput],
    });

    const ecsDeploy = new codepipeline_actions.EcsDeployAction({
      actionName: 'Deploy-Fargate-Test',
      service: props.fargateServiceTest.service,
      input: dockerBuildOutput,
    });

    const manualApproval = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Approve-Deploy-Prod',
      runOrder: 1,
    });

    const ecsProdDeploy = new codepipeline_actions.EcsDeployAction({
      actionName: 'Deploy-Fargate-Prod',
      service: props.fargateServiceProd.service,
      input: dockerBuildOutput,
      runOrder: 2,
    });


    // Define the pipeline and a basic stage
    new codepipeline.Pipeline(this, 'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Code-Quality-Testing',
          actions: [build],
        },
        {
          stageName: 'Docker-Push-ECR',
          actions: [docker],
        },
        {
          stageName: 'Deploy-Test',
          actions: [ecsDeploy],
        },
        {
          stageName: 'Deploy-Production',
          actions: [manualApproval, ecsProdDeploy],
        }
      ],
    });

    // Output the GitHub repository URL
    new cdk.CfnOutput(this, 'GitHubRepositoryUrl', {
      value: `https://github.com/rwangnet/CICD_Workshop`,
    });
  }

}
