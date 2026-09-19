interface IncomingEmailMessage {
  setReject(reason: string): void;
  forward(destination: string): Promise<unknown>;
}

interface Env {
  SUPPORT_FORWARD_TO?: string;
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({
      service: "fuelpro-email-router",
      status: "ok",
      provider: "cloudflare-email-routing",
    });
  },

  async email(message: IncomingEmailMessage, env: Env): Promise<void> {
    const destination = String(env.SUPPORT_FORWARD_TO || "").trim();
    if (!destination) {
      message.setReject("FuelPro support destination is not configured");
      return;
    }

    // Keep Cloudflare as the receiving edge. The final mailbox must be a
    // verified Email Routing destination in the same Cloudflare account.
    await message.forward(destination);
  },
};
