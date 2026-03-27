import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const userApiKey = req.headers.get("x-api-key");
    const apiKey = userApiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 401 });
    }

    const client = new OpenAI({ apiKey });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");
    const mimeType = file.type;

    const prompt = `
      你是一個物流單據辨識專家。請從提供的『危險貨物申報單』中提取資訊並輸出 JSON。
      
      ### 嚴格提取規則：
      1. CONTAINER_NUMBER: 提取欄位15。只需保留「純貨櫃編號」(通常為4碼英文+7碼數字)。
      2. UN_NUMBER: 四位編號數字(UN NO 旁的四位數字)。
      3. CLASS: 主要等級。
      4. SUB_CLASS: SUBSIDIARY HAZARD CLASS副次危險性等級 (無則填 "" 空字串)。
      5. PACKING_GROUP (PG): 容器等級 I, II 或 III。
      6. FLASH_POINT (FP): 提取引火點溫度數字及單位。
      7. MARINE_POLLUTANTS (MP): 
         - 識別欄位名稱如 Marine pollutant, marine pollutants, MP 等。
         - 若內容為 NIL, NO, N/A, NA, NON 則一律輸出 "NO"。
         - 看到 YES 或 REQUIRED 則輸出 "YES"。
      8. LIMITED_QUANTITIES (LQ): 
         - 識別欄位名稱如 Limited quantity, LQ, limit quality 等。
         - 只要出現上述關鍵字且後方沒有標註 NO，一律輸出 "YES"。
         - 否則輸出 "NO"。
      9. EMERGENCY_CONTACT: 提取聯絡人姓名及完整電話。
      10. NET_WEIGHT: 提取淨重數字。
      11. SGG_GROUP: 
         - 識別 Segregation Group 或 SGG 欄位。
         - 提取編號數字 (例如 SGG 1 則輸出 "1")。
      12. SHIPPING_NAME (技術名稱規則): 
         - 檢查 Proper Shipping Name 欄位。
         - 只有當品名中出現 "N.O.S." 時，提取其後方所有括號 () 內的內容。
         - 若品名中沒有 "N.O.S."，此欄位必須保持為「空白」。

      請僅輸出 JSON 代碼塊，不要有其他解釋。
    `;

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = response.choices[0].message.content;
    return NextResponse.json(JSON.parse(result || "{}"));
  } catch (error: any) {
    console.error("OpenAI Error:", error);
    return NextResponse.json({ error: error.message || "Failed to extract data" }, { status: 500 });
  }
}
