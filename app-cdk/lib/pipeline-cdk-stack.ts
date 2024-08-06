import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';


export class PipelineCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Define a CodePipeline source action using GitHub
    const sourceOutput = new codepipeline.Artifact();
    const unitTestOutput = new codepipeline.Artifact();


    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: 'rwangnet', // Replace with your GitHub username
      repo: 'CICD_Workshop',        // Replace with your repository name
      branch: 'main',                // Replace with your branch
      oauthToken: cdk.SecretValue.secretsManager('github-token', { jsonField: 'github-token' }), // Replace with your secret name
      output: sourceOutput,
    });

    // Define a dummy action as a placeholder
    const approval = new codepipeline_actions.ManualApprovalAction({
      actionName: 'DummyApproval',
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
        }
      ],
    });

    // Output the GitHub repository URL
    new cdk.CfnOutput(this, 'GitHubRepositoryUrl', {
      value: `https://github.com/rwangnet/CICD_Workshop`,
    });
  }
}
