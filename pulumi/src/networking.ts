import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface NetworkingArgs {
    vpcCidr: string;
    subnetCidr: string;
    stackName: string;
}

export class Networking extends pulumi.ComponentResource {
    public readonly vpc: aws.ec2.Vpc;
    public readonly subnets: aws.ec2.Subnet[];
    public readonly internetGateway: aws.ec2.InternetGateway;
    public readonly routeTable: aws.ec2.RouteTable;
    public readonly securityGroup: aws.ec2.SecurityGroup;

    constructor(name: string, args: NetworkingArgs, opts?: pulumi.ComponentResourceOptions) {
        super("ec2-ena-express-lab:networking:Networking", name, {}, opts);

        // Create VPC
        this.vpc = new aws.ec2.Vpc(`${name}-vpc`, {
            cidrBlock: args.vpcCidr,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            tags: {
                Name: `${args.stackName}-vpc`,
            },
        }, { parent: this });

        // Create public subnets in multiple availability zones
        this.subnets = [];
        
        // Calculate CIDR blocks for subnets
        const cidrParts = args.subnetCidr.split('/');
        const baseIp = cidrParts[0];
        const prefix = parseInt(cidrParts[1], 10);
        
        // Create subnets in the first two availability zones
        const availabilityZones = pulumi.output(aws.getAvailabilityZones()).names;
        
        // First subnet - use a different CIDR to avoid conflicts
        // For example, if args.subnetCidr is 192.168.1.0/24, we'll use 192.168.3.0/24
        const ipParts = baseIp.split('.');
        const firstSubnetOctet = parseInt(ipParts[2], 10) + 2; // Use +2 to avoid conflicts
        const subnet1Cidr = `${ipParts[0]}.${ipParts[1]}.${firstSubnetOctet}.0/${prefix}`;
        
        const subnet1 = new aws.ec2.Subnet(`${name}-subnet-1`, {
            vpcId: this.vpc.id,
            cidrBlock: subnet1Cidr,
            mapPublicIpOnLaunch: true,
            availabilityZone: availabilityZones[0],
            tags: {
                Name: `${args.stackName}-public-subnet-1`,
            },
        }, { parent: this });
        this.subnets.push(subnet1);
        
        // Second subnet - calculate a new CIDR block
        // For example, if first subnet is 192.168.3.0/24, we'll use 192.168.4.0/24
        const secondSubnetOctet = firstSubnetOctet + 1;
        const subnet2Cidr = `${ipParts[0]}.${ipParts[1]}.${secondSubnetOctet}.0/${prefix}`;
        
        const subnet2 = new aws.ec2.Subnet(`${name}-subnet-2`, {
            vpcId: this.vpc.id,
            cidrBlock: subnet2Cidr,
            mapPublicIpOnLaunch: true,
            availabilityZone: availabilityZones[1],
            tags: {
                Name: `${args.stackName}-public-subnet-2`,
            },
        }, { parent: this });
        this.subnets.push(subnet2);

        // Create internet gateway
        this.internetGateway = new aws.ec2.InternetGateway(`${name}-igw`, {
            vpcId: this.vpc.id,
            tags: {
                Name: `${args.stackName}-igw`,
            },
        }, { parent: this });

        // Create route table
        this.routeTable = new aws.ec2.RouteTable(`${name}-rt`, {
            vpcId: this.vpc.id,
            routes: [
                {
                    cidrBlock: "0.0.0.0/0",
                    gatewayId: this.internetGateway.id,
                },
            ],
            tags: {
                Name: `${args.stackName}-rt`,
            },
        }, { parent: this });

        // Associate route table with subnets
        for (let i = 0; i < this.subnets.length; i++) {
            const routeTableAssociation = new aws.ec2.RouteTableAssociation(`${name}-rt-assoc-${i+1}`, {
                subnetId: this.subnets[i].id,
                routeTableId: this.routeTable.id,
            }, { parent: this });
        }

        // Create security group
        this.securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
            vpcId: this.vpc.id,
            description: "Security group for ENA Express testing",
            // Inbound rules
            ingress: [
                // Allow all traffic from the security group itself
                {
                    protocol: "-1",  // All protocols
                    fromPort: 0,
                    toPort: 0,
                    self: true,
                    description: "Allow all traffic from the security group itself",
                },
                // Allow SSH access from anywhere
                {
                    protocol: "tcp",
                    fromPort: 22,
                    toPort: 22,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow SSH access from anywhere",
                },
            ],
            // Outbound rules - allow all traffic
            egress: [
                {
                    protocol: "-1",  // All protocols
                    fromPort: 0,
                    toPort: 0,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow all outbound traffic",
                },
            ],
            tags: {
                Name: `${args.stackName}-sg`,
            },
        }, { parent: this });

        this.registerOutputs({
            vpcId: this.vpc.id,
            subnetIds: pulumi.output(this.subnets).apply(subnets => subnets.map(subnet => subnet.id)),
            securityGroupId: this.securityGroup.id,
        });
    }
}
