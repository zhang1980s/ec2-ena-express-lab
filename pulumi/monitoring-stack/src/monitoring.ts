import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

export interface MonitoringArgs {
    stackName: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    grafanaPassword: string;
    testInstanceIps?: string[];
}

export class Monitoring extends pulumi.ComponentResource {
    public readonly exporterRepository: awsx.ecr.Repository;
    public readonly grafanaUrl: pulumi.Output<string>;

    constructor(name: string, args: MonitoringArgs, opts?: pulumi.ComponentResourceOptions) {
        super("ec2-ena-express-lab:monitoring:Monitoring", name, {}, opts);

        // Create security groups
        const prometheusSecurityGroup = new aws.ec2.SecurityGroup(`${name}-prometheus-sg`, {
            vpcId: args.vpcId,
            description: "Security group for Prometheus",
            egress: [{
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
            }],
            tags: {
                Name: `${args.stackName}-prometheus-sg`,
            },
        }, { parent: this });

        const grafanaSecurityGroup = new aws.ec2.SecurityGroup(`${name}-grafana-sg`, {
            vpcId: args.vpcId,
            description: "Security group for Grafana",
            ingress: [{
                protocol: "tcp",
                fromPort: 3000,
                toPort: 3000,
                cidrBlocks: ["0.0.0.0/0"],
                description: "Allow web access to Grafana",
            }],
            egress: [{
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
            }],
            tags: {
                Name: `${args.stackName}-grafana-sg`,
            },
        }, { parent: this });

        // Allow Grafana to access Prometheus
        new aws.ec2.SecurityGroupRule(`${name}-grafana-to-prometheus`, {
            type: "ingress",
            fromPort: 9090,
            toPort: 9090,
            protocol: "tcp",
            sourceSecurityGroupId: grafanaSecurityGroup.id,
            securityGroupId: prometheusSecurityGroup.id,
            description: "Allow Grafana to access Prometheus",
        }, { parent: this });

        // Create ECR repository for sockperf exporter
        this.exporterRepository = new awsx.ecr.Repository(`${name}-exporter-repo`, {
            forceDelete: true,
        }, { parent: this });

        // Create ECS cluster
        const cluster = new aws.ecs.Cluster(`${name}-cluster`, {
            tags: {
                Name: `${args.stackName}-monitoring-cluster`,
            },
        }, { parent: this });

        // Create log groups
        const prometheusLogGroup = new aws.cloudwatch.LogGroup(`${name}-prometheus-logs`, {
            retentionInDays: 7,
            tags: {
                Name: `${args.stackName}-prometheus-logs`,
            },
        }, { parent: this });

        const grafanaLogGroup = new aws.cloudwatch.LogGroup(`${name}-grafana-logs`, {
            retentionInDays: 7,
            tags: {
                Name: `${args.stackName}-grafana-logs`,
            },
        }, { parent: this });

        // Create IAM roles for ECS tasks
        const taskExecutionRole = new aws.iam.Role(`${name}-task-execution-role`, {
            assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
                Service: "ecs-tasks.amazonaws.com",
            }),
            tags: {
                Name: `${args.stackName}-task-execution-role`,
            },
        }, { parent: this });

        new aws.iam.RolePolicyAttachment(`${name}-task-execution-policy`, {
            role: taskExecutionRole.name,
            policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
        }, { parent: this });

        // Create Prometheus configuration
        const prometheusConfig = pulumi.interpolate`
global:
  scrape_interval: 1s
  evaluation_interval: 1s

scrape_configs:
  - job_name: 'sockperf'
    static_configs:
      - targets: ${args.testInstanceIps ? args.testInstanceIps.map(ip => `${ip}:9091`) : ["instance-1:9091", "instance-2:9091"]}
        labels:
          group: 'sockperf'
          environment: 'test'
    
  - job_name: 'node'
    static_configs:
      - targets: ${args.testInstanceIps ? args.testInstanceIps.map(ip => `${ip}:9100`) : ["instance-1:9100", "instance-2:9100"]}
        labels:
          group: 'nodes'
          environment: 'test'
    
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
        labels:
          group: 'monitoring'
`;

        // Create task definitions
        const prometheusTaskDef = new aws.ecs.TaskDefinition(`${name}-prometheus-task`, {
            family: "prometheus",
            cpu: "1024",
            memory: "2048",
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            executionRoleArn: taskExecutionRole.arn,
            containerDefinitions: pulumi.interpolate`[
                {
                    "name": "prometheus",
                    "image": "prom/prometheus:latest",
                    "essential": true,
                    "logConfiguration": {
                        "logDriver": "awslogs",
                        "options": {
                            "awslogs-group": "${prometheusLogGroup.name}",
                            "awslogs-region": "${aws.config.region}",
                            "awslogs-stream-prefix": "prometheus"
                        }
                    },
                    "portMappings": [
                        {
                            "containerPort": 9090,
                            "hostPort": 9090,
                            "protocol": "tcp"
                        }
                    ],
                    "environment": [
                        {
                            "name": "TZ",
                            "value": "UTC"
                        }
                    ],
                    "command": [
                        "--config.file=/etc/prometheus/prometheus.yml"
                    ],
                    "mountPoints": [
                        {
                            "sourceVolume": "prometheus-config",
                            "containerPath": "/etc/prometheus",
                            "readOnly": true
                        }
                    ]
                }
            ]`,
            volumes: [
                {
                    name: "prometheus-config",
                    efsVolumeConfiguration: {
                        fileSystemId: "fs-12345678", // Replace with actual EFS ID or create one
                        rootDirectory: "/prometheus",
                    },
                },
            ],
            tags: {
                Name: `${args.stackName}-prometheus-task`,
            },
        }, { parent: this });

        const grafanaTaskDef = new aws.ecs.TaskDefinition(`${name}-grafana-task`, {
            family: "grafana",
            cpu: "1024",
            memory: "2048",
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            executionRoleArn: taskExecutionRole.arn,
            containerDefinitions: pulumi.interpolate`[
                {
                    "name": "grafana",
                    "image": "grafana/grafana:latest",
                    "essential": true,
                    "logConfiguration": {
                        "logDriver": "awslogs",
                        "options": {
                            "awslogs-group": "${grafanaLogGroup.name}",
                            "awslogs-region": "${aws.config.region}",
                            "awslogs-stream-prefix": "grafana"
                        }
                    },
                    "portMappings": [
                        {
                            "containerPort": 3000,
                            "hostPort": 3000,
                            "protocol": "tcp"
                        }
                    ],
                    "environment": [
                        {
                            "name": "GF_SECURITY_ADMIN_PASSWORD",
                            "value": "${args.grafanaPassword}"
                        },
                        {
                            "name": "GF_INSTALL_PLUGINS",
                            "value": "grafana-piechart-panel,grafana-worldmap-panel"
                        },
                        {
                            "name": "TZ",
                            "value": "UTC"
                        }
                    ]
                }
            ]`,
            tags: {
                Name: `${args.stackName}-grafana-task`,
            },
        }, { parent: this });

        // Create services
        const prometheusService = new aws.ecs.Service(`${name}-prometheus-service`, {
            cluster: cluster.arn,
            taskDefinition: prometheusTaskDef.arn,
            desiredCount: 1,
            launchType: "FARGATE",
            networkConfiguration: {
                subnets: args.subnetIds,
                securityGroups: [prometheusSecurityGroup.id],
                assignPublicIp: true,
            },
            tags: {
                Name: `${args.stackName}-prometheus-service`,
            },
        }, { parent: this });

        // Create ALB for Grafana
        const grafanaAlb = new aws.lb.LoadBalancer(`${name}-grafana-alb`, {
            internal: false,
            loadBalancerType: "application",
            securityGroups: [grafanaSecurityGroup.id],
            subnets: args.subnetIds,
            enableDeletionProtection: false,
            tags: {
                Name: `${args.stackName}-grafana-alb`,
            },
        }, { parent: this });

        const grafanaTargetGroup = new aws.lb.TargetGroup(`${name}-grafana-tg`, {
            port: 3000,
            protocol: "HTTP",
            targetType: "ip",
            vpcId: args.vpcId,
            healthCheck: {
                path: "/api/health",
                port: "3000",
                protocol: "HTTP",
                timeout: 5,
                interval: 30,
                healthyThreshold: 3,
                unhealthyThreshold: 3,
                matcher: "200",
            },
            tags: {
                Name: `${args.stackName}-grafana-tg`,
            },
        }, { parent: this });

        const grafanaListener = new aws.lb.Listener(`${name}-grafana-listener`, {
            loadBalancerArn: grafanaAlb.arn,
            port: 80,
            protocol: "HTTP",
            defaultActions: [{
                type: "forward",
                targetGroupArn: grafanaTargetGroup.arn,
            }],
            tags: {
                Name: `${args.stackName}-grafana-listener`,
            },
        }, { parent: this });

        const grafanaService = new aws.ecs.Service(`${name}-grafana-service`, {
            cluster: cluster.arn,
            taskDefinition: grafanaTaskDef.arn,
            desiredCount: 1,
            launchType: "FARGATE",
            networkConfiguration: {
                subnets: args.subnetIds,
                securityGroups: [grafanaSecurityGroup.id],
                assignPublicIp: true,
            },
            loadBalancers: [{
                targetGroupArn: grafanaTargetGroup.arn,
                containerName: "grafana",
                containerPort: 3000,
            }],
            tags: {
                Name: `${args.stackName}-grafana-service`,
            },
        }, { parent: this, dependsOn: [grafanaListener] });

        // Set outputs
        this.grafanaUrl = pulumi.interpolate`http://${grafanaAlb.dnsName}`;

        this.registerOutputs({
            exporterRepositoryUrl: this.exporterRepository.url,
            grafanaUrl: this.grafanaUrl,
        });
    }
}
