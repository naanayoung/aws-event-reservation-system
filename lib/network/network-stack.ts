import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class NetworkStack extends Stack {
	public readonly vpc: ec2.Vpc;

	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		// VPC 생성
		this.vpc = new ec2.Vpc(this, 'EventReservationVpc', {
			maxAzs: 2, // Multi-AZ 배포를 위해 2개의 AZ 사용
			natGateways: 1,
			subnetConfiguration: [
				{
					cidrMask: 24,
					name: 'PublicSubnet',
					subnetType: ec2.SubnetType.PUBLIC,
				},
				{
					cidrMask: 24,
					name: 'PrivatSubnet',
					subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
				},
			],
		});
	}
}
