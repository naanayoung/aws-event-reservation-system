import { APIGatewayEvent } from "aws-lambda";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const dynamoDb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME || "";

export const handler = async (event: APIGatewayEvent) => {
  const { eventId, seatId, userId } = event.queryStringParameters || {};

  if (!eventId || !seatId || !userId) {  // eventId, seatId, userId 가 없을 경우
    console.log( "eventId, seatId, userId 가 올바르지 않음" );
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Missing eventId, seatId or userId" }),
    };
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
	    eventId: { S: eventId },
	    seatId: { S: seatId },
    },
    ConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
	    ":userId": { S: userId },
    },
  };

  try {     // DynamoDB에 예약 삭제하라는 요청(DELETE) 보내기.
    console.log( "예약 삭제 요청 보내기 준비" ); 
    await dynamoDb.send(new DeleteItemCommand(params));
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Reservation cancelled successfully" }),
    };
  } catch (error: any) {
    if (error.name === "ConditionalCheckFailedException") {
      console.log( "해당하는 예약이 없습니다. 403")
      return {
        statusCode: 403,
        body: JSON.stringify({ message: "You are not allowed to cancel this reservation" }),
      };
    }
    console.error("Error cancelling reservation:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to cancel reservation", error: error.message }),
    };
  }
};

