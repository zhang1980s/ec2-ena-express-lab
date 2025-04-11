import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface NetworkingArgs {
    vpcCidr: string;
    subnetCidr: string;
    stackName: string;
}

export class Networking extends pulumi.ComponentResource {
    public readonly vpc: aws.ec2.Vpc;
    public readonly subnet: aws.ec2.Subnet;
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

        // Create public subnet
        this.subnet = new aws.ec2.Subnet(`${name}-subnet`, {
            vpcId: this.vpc.id,
            cidrBlock: args.subnetCidr,
            mapPublicIpOnLaunch: true,
            availabilityZone: pulumi.output(aws.getAvailabilityZones()).names[0],
            tags: {
                Name: `${args.stackName}-public-subnet`,
            },
        }, { parent: this });

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

        // Associate route table with subnet
        const routeTableAssociation = new aws.ec2.RouteTableAssociation(`${name}-rt-assoc`, {
            subnetId: this.subnet.id,
            routeTableId: this.routeTable.id,
        }, { parent: this });

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
            subnetId: this.subnet.id,
            securityGroupId: this.securityGroup.id,
        });
    }
}
