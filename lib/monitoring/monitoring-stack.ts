import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

interface MonitoringStackProps extends StackProps {
	reserveLambda: lambda.IFunction;
	processLambda: lambda.IFunction;
	cancelLambda: lambda.IFunction;
	reservationTable: dynamodb.ITable;
}

export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // ✅ SNS 알람 토픽 생성
    const alarmTopic = new sns.Topic(this, 'MonitoringAlarmTopic');
    alarmTopic.addSubscription(new sns_subs.EmailSubscription('ekfrha0327@gmail.com'));

    // ✅ 예약 요청 에러 알람
    const reserveAlarm = new cloudwatch.Alarm(this, 'ReserveErrorAlarm', {
      metric: props.reserveLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: '예약 요청 처리 에러 발생',
    });
    reserveAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    // ✅ 예약 처리 에러 알람
    const processAlarm = new cloudwatch.Alarm(this, 'ProcessErrorAlarm', {
      metric: props.processLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: '예약 처리 로직 에러 발생',
    });
    processAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    // ✅ 예약 취소 에러 알람
    const cancelAlarm = new cloudwatch.Alarm(this, 'CancelErrorAlarm', {
      metric: props.cancelLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: '예약 취소 에러 발생',
    });
    cancelAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    // cloudwatch 대시보드 생성
    const dashboard = new cloudwatch.Dashboard(this, 'ReservationDashboard', {
      dashboardName: 'EventReservationDashboard',
    });

    // 예약 요청,처리 Lambda 에러를 하나의 그래프 위젯으로 통합
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: '예약 요청 & 처리 Lambda 에러',
        left: [
          props.reserveLambda.metricErrors({ label: 'Reserve Lambda Errors' }),
          props.processLambda.metricErrors({ label: 'Process Lambda Errors' }),
        ],
        width: 24
      }),
    );

    // 예약 취소 Lambda 에러 단독 위젯
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: '예약 취소 Lambda 에러',
        left: [
          props.cancelLambda.metricErrors({ label: 'Cancel Lambda Errors' }),
        ],
        width: 24
      }),
    );
   
    // DynamoDB Throttled Requests 위젯
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttled Requests',
        left: [
          props.reservationTable.metricThrottledRequests({
            label: 'DDB Throttles',
          }),
        ],
        width: 24
      }),
    );
  }
}



