#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network/network-stack';
import { ComputeStack } from '../lib/compute/compute-stack';
import { DatabaseStack } from '../lib/database/database-stack';
import { ApplicationStack } from '../lib/application/application-stack';
import { StorageStack } from '../lib/storage/storage-stack';
import { MonitoringStack } from '../lib/monitoring/monitoring-stack';

const app = new cdk.App();

// 네트워크 스택 생성
// 나중에 networkStack.vpc를 다른 Stack에서 사용하게 넘겨줄 수 있음. 
const networkStack = new NetworkStack(app, 'NetworkStack');

// 컴퓨트 스택 생성
//props로 networkStack의 vpc 넘겨줘야함.
// vpc 꺼내서 그 위에 asg(privat suvnet), alb(puvlic suvnet) 생성하는 것. 
const computeStack = new ComputeStack(app, 'ComputeStack', {
	vpc: networkStack.vpc,
});

// 데이터베이스 스택 생성
const databaseStack = new DatabaseStack(app, 'DatabaseStack');

// 애플리케이션 스택 생성
// databaseStack의 reservationTable 보내기. lib/database/database-stack.ts에서 받
const applicationStack = new ApplicationStack(app, 'ApplicationStack', {
	reservationTable: databaseStack.reservationTable,
});

// 스토리지 스택 생성
const storageStack = new StorageStack(app, 'StorageStack');

// 모니터링 스택 생성
const monitoringStack = new MonitoringStack(app, 'MonitoringStack', {
	reserveLambda: applicationStack.reserveSeatLambda,
	processLambda: applicationStack.processReservationLambda,
	cancelLambda: applicationStack.cancelReservationLambda,
	reservationTable: databaseStack.reservationTable,
});
