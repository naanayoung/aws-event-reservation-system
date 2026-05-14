import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

interface ApplicationStackProps extends StackProps {
	reservationTable: dynamodb.ITable;
	// ITable : 다른 스택에서 넘겨받을 떄 ITable 인터페이스로 받음. 

	vpc: ec2.IVpc;
	//NEtworkStack에서 생성한 VPC를 받아 lambda를 private subnet에 배치
}

export class ApplicationStack extends Stack {
	public readonly reserveSeatLambda: lambda.Function;
	public readonly processReservationLambda: lambda.Function;
	public readonly cancelReservationLambda: lambda.Function;
	//monitoringStack에서 참조하기 위해 멤버로 노출
	public readonly reserveSeatAlias: lambda.Alias;

	constructor(scope: Construct, id: string, props: ApplicationStackProps) {
		super(scope, id, props);  // 상위클래스(Stack)의 생성자를 호출

		const reservationTable = props.reservationTable;
		const vpc = props.vpc;

		//* Lambda 공통 VPC 설정 - private subnet에 배치
		const lambdaVpcConfig = {
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
		};

		// SQS FIFO 큐 생성
    		const reservationQueue = new sqs.Queue(this, 'ReservationQueue', {
      			queueName: 'ReservationQueue.fifo',
      			fifo: true,
      			contentBasedDeduplication: true,	
    		});

		// SNS 주제 생성
    		const reservationTopic = new sns.Topic(this, 'ReservationTopic', {
            		displayName: 'Reservation Success Notification',
    		});

		// 예약 요청 Lambda
    		this.reserveSeatLambda = new NodejsFunction(this, 'ReserveSeatLambda', {
      			runtime: lambda.Runtime.NODEJS_18_X,
      			entry: 'lambda/reserveSeat.ts',  //.ts 파일 경로
			handler: 'handler', // 파일 안의 export const handler 를 실행 진입접으로 사용하라는 뜻.
      			...lambdaVpcConfig,
			environment: {
        			QUEUE_URL: reservationQueue.queueUrl,
				TOPIC_ARN: reservationTopic.topicArn,
				TABLE_NAME: reservationTable.tableName,
      			},
    		});

		//* 예약 요청 Lambda - Provisioned Concurrency 적용
		// alias를 만들고 그 alias를 API GW 호출 대상으로 연결해야됨.
		this.reserveSeatAlias = new lambda.Alias(this, 'ReserveSeatAlias', {
			aliasName: 'prod',
			version: this.reserveSeatLambda.currentVersion,
//			provisionedConcurrentExecutions: 2,  계정 동시성 한도 때문에 주석처리.
		});


		// 예약 처리 Lambda 생성
    		this.processReservationLambda = new NodejsFunction(this, 'ProcessReservationLambda', {
      			runtime: lambda.Runtime.NODEJS_18_X,
			entry: 'lambda/processReservation.ts',
			handler: 'handler',
      			...lambdaVpcConfig,
			environment: {
        			QUEUE_URL: reservationQueue.queueUrl,
        			TOPIC_ARN: reservationTopic.topicArn,
  				TABLE_NAME: reservationTable.tableName,
      			},
    		});

		// 예약 취소 Lambda 생성
		this.cancelReservationLambda = new NodejsFunction(this, 'CancelReservationLambda', {
      			runtime: lambda.Runtime.NODEJS_18_X,
      			entry: 'lambda/cancelReservation.ts',
			handler: 'handler',
      			...lambdaVpcConfig,
      			environment: {
        			TABLE_NAME: reservationTable.tableName,
      			},
    		});


		// API Gateway
    		const api = new apigateway.RestApi(this, 'EventReservationApi', {
      			restApiName: 'EventReservationService',
			endpointConfiguration: {
				types: [apigateway.EndpointType.REGIONAL],
			},
		});
		

		const reserve = api.root.addResource('reserve');
		// reserve는 alias를 호출 대상으로 지정-> Provisioned Concurrency가 실제로 사용됨.
		reserve.addMethod('POST', new apigateway.LambdaIntegration(this.reserveSeatAlias), {
			methodResponses: [
    			{
      				statusCode: '200',
      				responseParameters: {
        				'method.response.header.Access-Control-Allow-Origin': true,
      				},
    			},
  			],
      		},
				 );
		
		const cancel = api.root.addResource('cancel');
		cancel.addMethod('POST', new apigateway.LambdaIntegration(this.cancelReservationLambda), {
			methodResponses: [
    			{
      				statusCode: '200',
      				responseParameters: {
        				'method.response.header.Access-Control-Allow-Origin': true,
      				},
    			},],
		});

		// 권한 연결
		reservationQueue.grantSendMessages(this.reserveSeatLambda);
    		reservationQueue.grantConsumeMessages(this.processReservationLambda);
    		reservationTopic.grantPublish(this.processReservationLambda);
		reservationTable.grantWriteData(this.processReservationLambda);
		reservationTable.grantReadWriteData(this.cancelReservationLambda);
		// API GW가 alias를 호출하므로 alias에 invoke 권한 부여
		this.reserveSeatAlias.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
	      	this.cancelReservationLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

		// SQS -> processReservationLambda 이벤트 소스 연결
		this.processReservationLambda.addEventSource(
			new lambdaEventSources.SqsEventSource(reservationQueue, {
			batchSize: 5,
			})
		);

		// SNS 이메일 구독자 추가
		reservationTopic.addSubscription(new sns_subs.EmailSubscription('ekfrha0327@gmail.com'));
	}
}
