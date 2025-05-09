import { APIGatewayEvent, Context } from "aws-lambda";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqsClient = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL || "";


export const handler = async (event: APIGatewayEvent, context: Context) => {
    try {
	console.log(" Event received:", JSON.stringify(event));

        if (!event.body) {
		console.error(" event body가 없습니다!");
		return { statusCode: 400, body: JSON.stringify({ message: "Missing event body" }) };
	}
        const { eventId, seatId, userId } = JSON.parse(event.body || "{}");
        if (!eventId || !seatId || !userId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields" }) };
        }

        // SQS FIFO 메시지 생성
        const params = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({ eventId, seatId, userId }),
            MessageGroupId: seatId, // 같은 이벤트에 대한 요청을 순차적으로 처리
            MessageDeduplicationId: `${seatId}-${userId}`, // 중복 방지
        };
	
	console.log(" SQS 메시지 전송 준비 완료", params);
        await sqsClient.send(new SendMessageCommand(params));  // SQS 큐로 메시지 전송
	console.log(" SQS 메시지 전송 완료!");

        return { statusCode: 200, body: JSON.stringify({ message: "Reservation request queued" }) };
    } catch (error: any) {
        console.error("Error:", error);
        return { statusCode: 500, body: JSON.stringify({ message: "Error queuing reservation", error: error.message }) };
    }


};

