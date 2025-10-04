import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// 어떤 VPC에 속하는 EC2를 만들지 알아야 됨.
// CDK는 Stack 간에 리소스를 전달할 때 interface를 써서 props를 넘기는 방식을 추천.
// StackProps = env 같은 거.
interface ComputeStackProps extends StackProps {
	vpc: ec2.IVpc;
}

// ComputeStackProps 안에 VPC를 꺼내서 그 VPC 위에 EC2, ALB를 올리는 것. 
export class ComputeStack extends Stack {
	constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

	const vpc = props.vpc;

	// ALB 적용 SG
	const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSG', {
        	vpc,
        	description: 'Allow HTTP traffic from anywhere',
        	allowAllOutbound: true,
	});
	// 모든 HTTP 인바운드 허용
	albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from anywhere');

	// EC2 적용 SG
	const ec2SecurityGroup = new ec2.SecurityGroup(this, 'Ec2SG', {
        	vpc,
        	description: 'Allow HTTP from ALB only',
        	allowAllOutbound: true,
});
	// ALB 인바운드만 허용
	ec2SecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'Allow HTTP from ALB');

	// Launch Template 생성
	const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
		instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
		machineImage:ec2.MachineImage.latestAmazonLinux2023(),
		securityGroup: ec2SecurityGroup,
		keyName: 'event-reservation-develop',
	});
	

	// ASG 생성
	const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
		vpc,
		launchTemplate,
		minCapacity: 2,
		maxCapacity: 5,
		vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, //Private Subnet에 배치
	});


	// ALB 생성
	const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
		vpc, 
		internetFacing: true,
		securityGroup: albSecurityGroup,
		vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
	});
	
	// 포트 80에서 오는 요청을 alb가 수락함.
	const listener = alb.addListener('Listener', {
		port: 80,
		open: true,
	});

	// listener가 받은 요청을 보낼 타겟 = asg. 헬스체크하기.
	listener.addTargets('EC2Targets', {
		port: 80,
		targets: [asg],
		healthCheck: {
			path: '/',
			healthyHttpCodes: '200',
		},
	});
	}
}
