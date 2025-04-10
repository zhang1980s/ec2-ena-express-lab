import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as assets from 'aws-cdk-lib/aws-s3-assets';

export interface MonitoringStackProps extends cdk.StackProps {
  vpc?: ec2.IVpc;
  testInstances?: ec2.IInstance[];
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: MonitoringStackProps) {
    super(scope, id, props);

    // Use existing VPC if provided, otherwise create a new one
    const vpc = props?.vpc || new ec2.Vpc(this, 'MonitoringVpc', {
      ipAddresses: ec2.IpAddresses.cidr('192.168.2.0/24'),
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ]
    });

    // Create security groups
    const prometheusSecurityGroup = new ec2.SecurityGroup(this, 'PrometheusSecurityGroup', {
      vpc,
      description: 'Security group for Prometheus',
      allowAllOutbound: true,
    });

    const grafanaSecurityGroup = new ec2.SecurityGroup(this, 'GrafanaSecurityGroup', {
      vpc,
      description: 'Security group for Grafana',
      allowAllOutbound: true,
    });

    // Allow inbound traffic to Prometheus from Grafana
    prometheusSecurityGroup.addIngressRule(
      grafanaSecurityGroup,
      ec2.Port.tcp(9090),
      'Allow Grafana to access Prometheus'
    );

    // Allow inbound traffic to Grafana from anywhere (for web access)
    grafanaSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      'Allow web access to Grafana'
    );

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'MonitoringCluster', {
      vpc,
    });

    // Create log groups
    const prometheusLogGroup = new logs.LogGroup(this, 'PrometheusLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const grafanaLogGroup = new logs.LogGroup(this, 'GrafanaLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create ECR repository for sockperf exporter
    const exporterRepo = new ecr.Repository(this, 'SockperfExporterRepo', {
      repositoryName: 'sockperf-exporter',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create task definitions
    const prometheusTask = new ecs.FargateTaskDefinition(this, 'PrometheusTask', {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    const grafanaTask = new ecs.FargateTaskDefinition(this, 'GrafanaTask', {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    // Add container definitions
    const prometheusContainer = prometheusTask.addContainer('prometheus', {
      image: ecs.ContainerImage.fromRegistry('prom/prometheus:latest'),
      logging: new ecs.AwsLogDriver({
        logGroup: prometheusLogGroup,
        streamPrefix: 'prometheus',
      }),
      portMappings: [{ containerPort: 9090 }],
      environment: {
        'TZ': 'UTC',
      },
    });

    const grafanaContainer = grafanaTask.addContainer('grafana', {
      image: ecs.ContainerImage.fromRegistry('grafana/grafana:latest'),
      logging: new ecs.AwsLogDriver({
        logGroup: grafanaLogGroup,
        streamPrefix: 'grafana',
      }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        'GF_SECURITY_ADMIN_PASSWORD': 'admin',  // In production, use AWS Secrets Manager
        'GF_INSTALL_PLUGINS': 'grafana-piechart-panel,grafana-worldmap-panel',
        'TZ': 'UTC',
      },
    });

    // Create services
    const prometheusService = new ecs.FargateService(this, 'PrometheusService', {
      cluster,
      taskDefinition: prometheusTask,
      desiredCount: 1,
      securityGroups: [prometheusSecurityGroup],
      assignPublicIp: true,
    });

    const grafanaService = new ecs.FargateService(this, 'GrafanaService', {
      cluster,
      taskDefinition: grafanaTask,
      desiredCount: 1,
      securityGroups: [grafanaSecurityGroup],
      assignPublicIp: true,
    });

    // Create ALB for Grafana
    const grafanaALB = new elbv2.ApplicationLoadBalancer(this, 'GrafanaALB', {
      vpc,
      internetFacing: true,
    });

    const grafanaListener = grafanaALB.addListener('GrafanaListener', {
      port: 80,
    });

    grafanaListener.addTargets('GrafanaTarget', {
      port: 3000,
      targets: [grafanaService],
      healthCheck: {
        path: '/api/health',
      },
    });

    // Output the Grafana URL
    new cdk.CfnOutput(this, 'GrafanaURL', {
      value: `http://${grafanaALB.loadBalancerDnsName}`,
      description: 'URL for Grafana dashboard',
    });

    // Output the ECR repository URI
    new cdk.CfnOutput(this, 'ExporterRepositoryURI', {
      value: exporterRepo.repositoryUri,
      description: 'URI for the sockperf exporter ECR repository',
    });
  }
}
