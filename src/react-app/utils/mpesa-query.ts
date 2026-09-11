// M-PESA Transaction Status Query Helper
// This allows checking the status of a transaction from Safaricom's servers

interface QueryResponse {
  ResultCode: string;
  ResultDesc: string;
  OriginatorConversationID?: string;
  ConversationID?: string;
  TransactionID?: string;
  ResultParameters?: {
    ResultParameter: Array<{
      Key: string;
      Value: any;
    }>;
  };
}

export async function queryMpesaTransactionStatus(
  checkoutRequestId: string,
  mpesaConsumerKey: string,
  mpesaConsumerSecret: string,
  mpesaShortcode: string,
  mpesaPasskey: string,
): Promise<QueryResponse> {
  // Get access token
  const auth = btoa(`${mpesaConsumerKey}:${mpesaConsumerSecret}`);

  const tokenResponse = await fetch(
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    },
  );

  if (!tokenResponse.ok) {
    throw new Error(`M-PESA auth failed: ${tokenResponse.statusText}`);
  }

  const tokenData: any = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  // Generate timestamp and password
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14);
  const password = btoa(`${mpesaShortcode}${mpesaPasskey}${timestamp}`);

  // Query transaction status
  const queryPayload = {
    BusinessShortCode: mpesaShortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const queryResponse = await fetch(
    "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(queryPayload),
    },
  );

  if (!queryResponse.ok) {
    throw new Error(`M-PESA query failed: ${queryResponse.statusText}`);
  }

  return await queryResponse.json();
}
