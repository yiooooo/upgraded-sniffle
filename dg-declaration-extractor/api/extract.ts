import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { Fields, Files } from "formidable";
import fs from "fs";
import OpenAI from "openai";
 
export const config = {
  api: {
    bodyParser: false,
  },
};
 
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
 
  const form = formidable({ keepExtensions: true });
 
  let fields: Fields;
  let files: Files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    return res.status(400).json({ error: "Failed to parse form data" });
  }
 
  const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: "No file uploaded" });
  }
 
  const userApiKey = req.headers["x-api-key"] as string;
  const apiKey = userApiKey || process.env.OPENAI_API_KEY;
 
  if (!apiKey) {
    return res.status(401).json({ error: "API Key is required" });
  }
 
  const client = new OpenAI({ apiKey });
 
  const fileBuffer = fs.readFileSync(uploadedFile.filepath);
  const base64Image = fileBuffer.toString("base64");
  const mimeType = uploadedFile.mimetype || "image/jpeg";
 
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
 
  try {
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
    return res.json(JSON.parse(result || "{}"));
  } catch (error: any) {
    console.error("OpenAI Error:", error);
    return res.status(500).json({ error: error.message || "Failed to extract data" });
  }
}
 