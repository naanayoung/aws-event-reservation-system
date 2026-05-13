# Serverless VPC 네트워크 설계와 비용 구조 비교 분석

서버리스 자원을 활용해 이벤트 예약 비동기 파이프라인을 설계하고,
NAT Gateway와 VPC Endpoint 두 네트워크 구성의 비용 구조를 직접 비교 분석한 프로젝트입니다.

---

## Architecture

**요청 흐름**

```
Client → API Gateway → Lambda(reserveSeat) → SQS FIFO → Lambda(processReservation) → DynamoDB
                                                                  └─→ SNS → Email
       └→ Lambda(cancelReservation) → DynamoDB
```

| 구성 요소 | 역할 |
|-----------|------|
| API Gateway | REST API 엔드포인트 (POST /reserve, POST /cancel) |
| Lambda (reserveSeat) | 요청 검증 후 SQS FIFO로 전달 |
| SQS FIFO | 좌석 기준 메시지 그룹으로 순차 처리 |
| Lambda (processReservation) | SQS 메시지 소비 → DynamoDB 저장 → SNS 알림 |
| Lambda (cancelReservation) | DynamoDB 예약 삭제 |
| DynamoDB | 예약 데이터 저장 (eventId + seatId 복합키) |
| SNS | 예약 성공 이메일 알림 |
| CloudWatch | Lambda·DynamoDB 에러 알람, 통합 대시보드 |

---

## Tech Stack

| 분류 | 기술 |
|------|------|
| Compute | AWS Lambda (Node.js 18) |
| API | API Gateway (REST, Regional) |
| Messaging | SQS (FIFO), SNS |
| Database | DynamoDB (PAY_PER_REQUEST) |
| Network | VPC, NAT Gateway, Private/Public Subnet |
| Storage | S3, CloudFront |
| Monitoring | CloudWatch Alarm, Dashboard |
| IaC | AWS CDK (TypeScript) |
| Load Test | Artillery |

---

## Key Design Decisions

**비동기 파이프라인**
- API Gateway → Lambda → SQS FIFO → Lambda → DynamoDB 구조로 요청 수신과 실제 처리를 분리
- Lambda 처리 실패 시 SQS 자동 재전달로 안정성 확보

**SQS FIFO 메시지 그룹**
- `MessageGroupId`를 `seatId`로 지정해 동일 좌석 요청을 순차 처리
- `MessageDeduplicationId`로 중복 메시지 방지

**멱등성 보장**
- `processReservation` Lambda에서 DynamoDB 조건부 쓰기 (`attribute_not_exists(seatId)`) 적용
- 재시도·중복 요청 상황에서도 좌석 중복 예약 방지

**Cold Start 완화**
- SQS Batch Size 1→5로 조정해 다건 요청 처리량 개선
- 앞단 Lambda(`reserveSeat`)에 Provisioned Concurrency 적용으로 초기 응답 지연 완화

**IaC 스택 분리**
- AWS CDK로 Network, Application, Database, Storage, Monitoring, Compute 6개 스택을 역할 기준으로 분리

**모니터링**
- Lambda 3종·DynamoDB Throttled Requests를 CloudWatch Alarm으로 감시
- SNS 이메일 구독으로 운영 알람 수신
- CloudWatch Dashboard에서 단일 대시보드로 통합

---

## 비용 분석 결과

AWS Pricing Calculator로 2-AZ 환경, 월 30만 건 요청 기준으로 두 네트워크 구성의 비용 구조를 시뮬레이션했습니다.

| 구분 | 구성 | 비고 |
|------|------|------|
| NAT Gateway 시나리오 | NAT GW 2개 (AZ당 1개) | 기준 |
| VPC Endpoint 시나리오 | DynamoDB Gateway 1개 + SQS·SNS·CloudWatch Interface 각 2개 (총 7개) | 약 36% 절감 |

> VPC Endpoint는 서비스별·AZ별로 개별 구성이 필요해 복잡도가 높지만, 데이터 처리 비용이 낮아 트래픽이 늘수록 절감 폭이 커집니다.

---

## How to Run

### 사전 준비
- Node.js 18+
- AWS CLI 설정 (`aws configure`)
- AWS CDK 설치 (`npm install -g aws-cdk`)

### 설치
```bash
npm install
```

### CDK 배포
```bash
# CDK 부트스트랩 (최초 1회)
cdk bootstrap

# 전체 스택 배포
cdk deploy --all

# 개별 스택 배포
cdk deploy NetworkStack
cdk deploy DatabaseStack
cdk deploy ApplicationStack
cdk deploy MonitoringStack
```

### 콘솔에서 추가 설정
다음 항목은 CDK 코드에 포함되지 않아 AWS 콘솔에서 직접 설정했습니다.

- Lambda 함수의 VPC 연결 (Private Subnet 배치)
- SQS Event Source의 Batch Size 조정 (1→5)
- `reserveSeat` Lambda에 Provisioned Concurrency 적용

### API 호출 예시
```bash
# 예약 요청
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/prod/reserve \
  -H "Content-Type: application/json" \
  -d '{"eventId": "DearYouth", "seatId": "A5", "userId": "YOUNG"}'

# 예약 취소
curl -X POST "https://<api-id>.execute-api.<region>.amazonaws.com/prod/cancel?eventId=DearYouth&seatId=A5&userId=YOUNG"
```

### 부하 테스트 (Artillery)
```bash
cd load-test
artillery run cancel-reservation.yml
```

### 리소스 정리
```bash
cdk destroy --all
```

---

## Directory Structure

```
aws-event-reservation-system/
├── bin/
│   └── event-reservation-system.ts        # CDK 앱 엔트리포인트
├── lib/
│   ├── network/network-stack.ts           # VPC, NAT Gateway, Subnet
│   ├── application/application-stack.ts   # Lambda, SQS, SNS, API Gateway
│   ├── database/database-stack.ts         # DynamoDB
│   ├── storage/storage-stack.ts           # S3 + CloudFront (결과 페이지)
│   ├── monitoring/monitoring-stack.ts     # CloudWatch Alarm, Dashboard
│   └── compute/compute-stack.ts           # ASG, ALB (대체 구성 옵션)
├── lambda/
│   ├── reserveSeat.ts                     # 예약 요청 핸들러
│   ├── processReservation.ts              # 예약 처리 핸들러
│   └── cancelReservation.ts               # 예약 취소 핸들러
├── load-test/
│   └── cancel-reservation.yml             # Artillery 부하 테스트 시나리오
├── static/                                # S3에 배포되는 정적 페이지
├── cdk.json
└── package.json
```
