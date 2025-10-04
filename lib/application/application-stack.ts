import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

interface ApplicationStackProps extends StackProps {
	reservationTable: dynamodb.ITable;
	// ITable : 다른 스택에서 넘겨받을 떄 ITable 인터페이스로 받음. 
}

export class ApplicationStack extends Stack {
	public readonly reserveSeatLambda: lambda.Function;
	public readonly processReservationLambda: lambda.Function;
	public readonly cancelReservationLambda: lambda.Function;
	
	constructor(scope: Construct, id: string, props: ApplicationStackProps) {
		super(scope, id, props);  // 상위클래스(Stack)의 생성자를 호출

		const reservationTable = props.reservationTable;

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
    		this.reserveSeatLambda = new lambda.Function(this, 'ReserveSeatLambda', {
      			runtime: lambda.Runtime.NODEJS_18_X,
      			handler: 'reserveSeat.handler', // lambda/reserveSeat.ts 파일 안의 export const handler 를 실행 진입접으로 사용하라는 뜻.
      			code: lambda.Code.fromAsset( 'lambda'), // lambda/ 디렉토리를 압축해서 Lambda에 업로드하라는 뜻.
      			environment: {
        			QUEUE_URL: reservationQueue.queueUrl,
				TOPIC_ARN: reservationTopic.topicArn,
				TABLE_NAME: reservationTable.tableName,
      			},
    		});

		// 예약 처리 Lambda 생성
    		this.processReservationLambda = new lambda.Function(this, 'ProcessReservationLambda', {
      			runtime: lambda.Runtime.NODEJS_18_X,
      			handler: 'processReservation.handler',
      			code: lambda.Code.fromAsset('lambda'),
      			environment: {
        			QUEUE_URL: reservationQueue.queueUrl,
        			TOPIC_ARN: reservationTopic.topicArn,
  				TABLE_NAME: reservationTable.tableName,
      			},
    		});

		// 예약 취소 Lambda 생성
		this.cancelReservationLambda = new lambda.Function(this, 'CancelReservationLambda', {
      			runtime: lambda.Runtime.NODEJS_18_X,
      			handler: 'cancelReservation.handler',
      			code: lambda.Code.fromAsset('lambda'),
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
		
		//CORS 대응을 위한 
		const reserveIntegration = new apigateway.LambdaIntegration(this.reserveSeatLambda, {
  			integrationResponses: [
    			{
      				statusCode: '200',
      				responseParameters: {
        				'method.response.header.Access-Control-Allow-Origin': "'*'",
      				},
    			}],
			passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_MATCH,
		});

		const cancelIntegration = new apigateway.LambdaIntegration(this.cancelReservationLambda, {
  			integrationResponses: [
    			{
      				statusCode: '200',
      				responseParameters: {
        				'method.response.header.Access-Control-Allow-Origin': "'*'",
      				},
    			}],
		});

		const reserve = api.root.addResource('reserve');
		reserve.addMethod('POST', new apigateway.LambdaIntegration(this.reserveSeatLambda), {
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
		this.reserveSeatLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
	      	this.cancelReservationLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

		this.processReservationLambda.addEventSource(
			new lambdaEventSources.SqsEventSource(reservationQueue, {
			batchSize: 10,
			})
		);

		// SNS 이메일 구독자 추가
		reservationTopic.addSubscription(new sns_subs.EmailSubscription('ekfrha0327@gmail.com'));
	}
}
