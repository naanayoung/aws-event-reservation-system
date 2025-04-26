import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';


export class EventReservationSystemStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB 테이블 생성
    const reservationTable = new dynamodb.Table(this, 'ReservationTable', {
      tableName: 'Reservations',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'seatId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Lambda 실행 역할 생성
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole'),
      ],
    });

    // SQS FIFO 큐 생성
    const reservationQueue = new sqs.Queue(this, 'ReservationQueue', {
      queueName: 'ReservationQueue.fifo',
      fifo: true,
      contentBasedDeduplication: true,
    });

    // 예약 요청 Lambda 생성
    const reserveSeatLambda = new lambda.Function(this, 'ReserveSeatLambda', {
      functionName: 'ReserveSeatLambda',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'reserveSeat.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaExecutionRole,
      environment: {
        QUEUE_URL: reservationQueue.queueUrl,
      },
      timeout: cdk.Duration.seconds(10),
    });
    reservationQueue.grantSendMessages(reserveSeatLambda);

    // SNS 주제 생성
    const reservationSuccessTopic = new sns.Topic(this, 'ReservationSuccessTopic', {
	    displayName: 'Reservation Success Notification',
    });

    // 예약 처리 Lambda 생성
    const processReservationLambda = new lambda.Function(this, 'ProcessReservationLambda', {
      functionName: 'ProcessReservationLambda',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'processReservation.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: reservationTable.tableName,
        QUEUE_URL: reservationQueue.queueUrl,
	TOPIC_ARN: reservationSuccessTopic.topicArn,
      },
      timeout: cdk.Duration.seconds(6),
    });
    processReservationLambda.addEventSource(new lambdaEventSources.SqsEventSource(reservationQueue, { batchSize: 1 }));
    reservationTable.grantWriteData(processReservationLambda);

    reservationSuccessTopic.grantPublish(processReservationLambda);
    // processReservationLambda가 reservationSuccessTopic(이메일 구독)에 발생하는 권한 추가


    // 예약 취소 Lambda 생성
    const cancelReservationLambda = new lambda.Function(this, 'CancelReservationLambda', {
      functionName: 'CancelReservationLambda',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'cancelReservation.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: reservationTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      timeout: cdk.Duration.seconds(6),
    });
    reservationTable.grantWriteData(cancelReservationLambda);

    // API Gateway 생성
    const api = new apigateway.RestApi(this, 'EventReservationApi', {
      restApiName: 'EventReservationService',
      deployOptions: { stageName: 'prod' },
    });

    // /reserve POST
    const reservationResource = api.root.addResource('reserve');
    reservationResource.addMethod('POST', new apigateway.LambdaIntegration(reserveSeatLambda), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });
    reserveSeatLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // /cancel-reservation DELETE
    const cancelResource = api.root.addResource('cancel-reservation');
    cancelResource.addMethod('DELETE', new apigateway.LambdaIntegration(cancelReservationLambda), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });
    cancelReservationLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    

    reservationSuccessTopic.addSubscription(
	new sns_subscriptions.EmailSubscription('enayoung0802@gmail.com')
    );

  }
}

