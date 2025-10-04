import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class DatabaseStack extends Stack {
	public readonly reservationTable: dynamodb.ITable;

	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		/* 기존 Reservations 테이블 import
		this.reservationTable = dynamodb.Table.fromTableName(this, 'ImportedReservationTalbe', 'Reservations');
	}
}*/

		// DynamoDB 테이블 생성
		this.reservationTable = new dynamodb.Table(this, 'ReservationTable', {
			tableName: 'Reservations-v2',
			partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'seatId', type: dynamodb.AttributeType.STRING },
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
	}
}
