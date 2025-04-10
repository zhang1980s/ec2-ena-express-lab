import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export class Ec2EnaExpressLabStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Create VPC with CIDR 192.168.0.0/16 and a public subnet with CIDR 192.168.1.0/24
    const vpc = new ec2.Vpc(this, 'EnaExpressVpc', {
      ipAddresses: ec2.IpAddresses.cidr('192.168.0.0/16'),
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // Get the public subnet
    const publicSubnet = vpc.publicSubnets[0];

    // 2. Create a cluster placement group
    const placementGroup = new ec2.CfnPlacementGroup(this, 'ClusterPlacementGroup', {
      strategy: 'cluster',
    });

    // 5. Create a security group with specified rules
    const securityGroup = new ec2.SecurityGroup(this, 'EnaExpressSecurityGroup', {
      vpc,
      description: 'Security group for ENA Express testing',
      allowAllOutbound: true, // Allow all outbound traffic by default
    });

    // Inbound: allow all traffic from the security group itself
    securityGroup.addIngressRule(
      securityGroup,
      ec2.Port.allTraffic(),
      'Allow all traffic from the security group itself'
    );

    // Inbound: allow SSH access from 0.0.0.0/0
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access from anywhere'
    );

    // Outbound: allow all traffic to the security group itself is already covered by allowAllOutbound: true
    // The default behavior with allowAllOutbound: true already allows all outbound traffic to 0.0.0.0/0

    // 8. Create EC2 role for Systems Manager access
    const ec2Role = new iam.Role(this, 'EC2SSMRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // 6. Get the latest Amazon Linux 2023 AMI
    const ami = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create the EC2 instances
    for (let i = 1; i <= 2; i++) {
      // Create the primary network interface
      const primaryEni = new ec2.CfnNetworkInterface(this, `PrimaryENI${i}`, {
        subnetId: publicSubnet.subnetId,
        groupSet: [securityGroup.securityGroupId],
        description: `Primary ENI for instance ${i}`,
      });

      // 7. Create second ENI (ENA Express will be enabled after deployment)
      const secondaryEni = new ec2.CfnNetworkInterface(this, `SecondaryENI${i}`, {
        subnetId: publicSubnet.subnetId,
        groupSet: [securityGroup.securityGroupId],
        description: `Secondary ENI for instance ${i} (Enable ENA Express after deployment)`,
      });
      
      // Note: ENA Express (EnaSrdSpecification) is not directly supported in CDK's CfnNetworkInterface
      // It needs to be enabled after deployment using the AWS CLI:
      // aws ec2 modify-network-interface-attribute --network-interface-id <eni-id> \
      //   --ena-srd-specification 'EnaSrdEnabled=true,EnaSrdUdpSpecification={EnaSrdUdpEnabled=true}'

      // 3. Create EC2 instance (c6i.8xlarge) in the placement group
      const instance = new ec2.CfnInstance(this, `EnaExpressInstance${i}`, {
        imageId: ami.getImage(this).imageId,
        instanceType: 'c6i.8xlarge',
        placementGroupName: placementGroup.ref,
        // 4. Use existing key pair (id: key-0b058d4d63764492c)
        keyName: 'keypair-sandbox0-sin-mymac',
        networkInterfaces: [
          {
            networkInterfaceId: primaryEni.ref,
            deviceIndex: '0',
          },
        ],
        iamInstanceProfile: new iam.CfnInstanceProfile(this, `InstanceProfile${i}`, {
          roles: [ec2Role.roleName],
        }).ref,
        tags: [
          {
            key: 'Name',
            value: `EnaExpressTestInstance${i}`,
          },
        ],
      });

      // Attach the secondary ENI to the instance
      new ec2.CfnNetworkInterfaceAttachment(this, `SecondaryENIAttachment${i}`, {
        instanceId: instance.ref,
        networkInterfaceId: secondaryEni.ref,
        deviceIndex: '1',
      });

      // Add dependencies to ensure proper creation order
      instance.addDependency(primaryEni);
      instance.addDependency(placementGroup);
    }

    // Output the VPC ID
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    // Output the security group ID
    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: securityGroup.securityGroupId,
      description: 'Security Group ID',
    });

    // Output the placement group name
    new cdk.CfnOutput(this, 'PlacementGroupName', {
      value: placementGroup.ref,
      description: 'Placement Group Name',
    });
    
    // Output the secondary ENI IDs for enabling ENA Express after deployment
    for (let i = 1; i <= 2; i++) {
      new cdk.CfnOutput(this, `SecondaryENI${i}Id`, {
        value: cdk.Fn.ref(`SecondaryENI${i}`),
        description: `Secondary ENI ${i} ID (Enable ENA Express on this ENI after deployment)`,
      });
    }
  }
}
