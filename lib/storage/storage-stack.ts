import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

export class StorageStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		// s3 버킷 생성
		const siteBucket = new s3.Bucket(this, 'StaticSiteBucket', {
			websiteIndexDocument: 'success.html',
			publicReadAccess: false, // cloudfront로만 접근 허용
			removalPolicy: RemovalPolicy.DESTROY, // cdk destroy 시 리소스를 실제로 삭제.
			autoDeleteObjects: true,  // 객체들도 함께 삭제
		});

		// CloudFront 배포 설정
		const distribution = new cloudfront.Distribution(this, 'StaticSiteDistribution', {
			defaultBehavior: {
				origin: new origins.S3Origin(siteBucket),
				viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
			},
			defaultRootObject: 'success.html',
		});

		// html 파일 S3에 업로드
		new s3deploy.BucketDeployment(this, 'DeployStaticSite', {
			sources: [s3deploy.Source.asset('static')],  // success.html
			destinationBucket: siteBucket,
			distribution,
			distributionPaths: ['/*'], // 배포 캐시 무효화
		});

		siteBucket.addToResourcePolicy(new iam.PolicyStatement({
			actions: ['s3:GetObject'],
			resources: [`${siteBucket.bucketArn}/*`],
			principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
			conditions: {
				StringEquals: {
					'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
				},
			},
		}));
	}
}
