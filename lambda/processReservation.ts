// processReservation.ts

import { SQSEvent } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";


const dynamoDb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME || "";
if (!TABLE_NAME) {
	console.error("XXXX ERROR: TABLE_NAME environment variable is missing or empty!");
	throw new Error("TABLE_NAME environment variable is not set");
}
const snsClient = new SNSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN || "";

export const handler = async (event: SQSEvent) => {
    //console.log(` TABLE_NAME: ${TABLE_NAME}`);

    const results = [];

    for (const record of event.Records) {
        try {
            const { eventId, seatId, userId } = JSON.parse(record.body);

            const params = {
                TableName: TABLE_NAME,
                Item: marshall({ eventId, seatId, userId, reservedAt: new Date().toISOString() }),
                ConditionExpression: "attribute_not_exists(seatId)", // 중복 예약 방지
            };

	    //console.log(" Saving to DynamoDB:", JSON.stringify(params, null, 2));
            await dynamoDb.send(new PutItemCommand(params));

            console.log(`예약 성공 Seat reserved: eventId=${eventId}, seatId=${seatId}, userId=${userId}`);   // 예약 성공
	    results.push({ statudsCode: 200, body: JSON.stringify({ message: "Seat reserved Successfully!!" }) });

	    await snsClient.send(new PublishCommand({
  	    TopicArn: TOPIC_ARN,
  	    Subject: "🎉 예약 성공!",
  	    Message: `예약이 완료되었습니다.\nEvent ID: ${eventId}, Seat ID: ${seatId}, User ID: ${userId}`,
	    }));
  
        } catch (error: any) {
		if (error.name === "ConditionalCheckFailedException") {
			// 중복 예약 발생 시 명확한 메시지 출력
			console.error(` 중복 예약 실패: eventId=${JSON.parse(record.body).eventId}, seatId=${JSON.parse(record.body).seatId}, userId=${JSON.parse(record.body).userId}`);
			results.push({ statusCode: 409, body: JSON.stringify({message: "The seat reserved already"})});
		} else {
			console.error("예약 처리 중 오류 발생:", error);
			results.push({ statusCode: 500, body: JSON.stringify({message: "Error"})});
        	}
    	}
    }

    // 모든 메시지 처리 후 응답 반환
    return { statusCode: 200, body: JSON.stringify({ results }) };
}
