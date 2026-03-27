"use client";

import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import * as XLSX from 'xlsx';
import { 
  Upload, 
  FileSpreadsheet, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Trash2, 
  Image as ImageIcon,
  Download,
  Settings,
  X,
  Key
} from 'lucide-react';

interface DGData {
  CONTAINER_NUMBER: string;
  UN_NUMBER: string;
  CLASS: string;
  SUB_CLASS: string;
  PACKING_GROUP: string;
  FLASH_POINT: string;
  MARINE_POLLUTANTS: string;
  LIMITED_QUANTITIES: string;
  EMERGENCY_CONTACT: string;
  NET_WEIGHT: string;
  SGG_GROUP: string;
  SHIPPING_NAME: string;
}

interface FileStatus {
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: DGData;
  error?: string;
  previewUrl: string;
}

type Provider = 'openai' | 'gemini';

export default function App() {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // API Settings
  const [provider, setProvider] = useState<Provider>('openai');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const savedProvider = localStorage.getItem('dg_provider') as Provider;
    if (savedProvider) setProvider(savedProvider);
    
    const savedKey = localStorage.getItem('dg_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  useEffect(() => {
    if (provider) localStorage.setItem('dg_provider', provider);
    if (apiKey) localStorage.setItem('dg_api_key', apiKey);
  }, [provider, apiKey]);

  useEffect(() => {
    console.log("Settings modal state:", showSettings);
  }, [showSettings]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file: File) => ({
        file,
        status: 'pending' as const,
        previewUrl: URL.createObjectURL(file)
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].previewUrl);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processFiles = async () => {
    if (!apiKey) {
      setShowSettings(true);
      alert("請先設定 API Key");
      return;
    }

    setIsProcessing(true);
    const updatedFiles = [...files];
    
    for (let i = 0; i < updatedFiles.length; i++) {
      if (updatedFiles[i].status === 'completed') continue;

      updatedFiles[i].status = 'processing';
      setFiles([...updatedFiles]);

      try {
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

        let resultJson;

        if (provider === 'gemini') {
          const genAI = new GoogleGenAI({ apiKey });
          const base64Data = await fileToBase64(updatedFiles[i].file);
          
          const response = await genAI.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: updatedFiles[i].file.type
                    }
                  }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json"
            }
          });
          
          resultJson = JSON.parse(response.text || "{}");
        } else {
          // OpenAI via Backend
          const formData = new FormData();
          formData.append("file", updatedFiles[i].file);

          const response = await fetch("/api/extract", {
            method: "POST",
            headers: {
              "x-api-key": apiKey
            },
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "辨識失敗");
          }

          resultJson = await response.json();
        }
        
        updatedFiles[i].status = 'completed';
        updatedFiles[i].result = resultJson;
      } catch (error) {
        console.error("Error processing file:", error);
        updatedFiles[i].status = 'error';
        updatedFiles[i].error = error instanceof Error ? error.message : "辨識發生錯誤";
      }
      
      setFiles([...updatedFiles]);
      
      if (i < updatedFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    setIsProcessing(false);
  };

  const exportToExcel = () => {
    const dataToExport = files
      .filter(f => f.status === 'completed' && f.result)
      .map(f => f.result!);

    if (dataToExport.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "DG Data");
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    XLSX.writeFile(workbook, `DG_Extraction_${timestamp}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans p-4 md:p-8">
      {/* Settings Modal - Always in DOM but hidden/visible via class */}
      <div className={`fixed inset-0 z-[99999] ${showSettings ? 'flex' : 'hidden'} items-center justify-center p-4`}>
        <div 
          className="absolute inset-0 bg-black/60"
          onClick={() => setShowSettings(false)}
        />
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] p-8 overflow-hidden border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Settings className="w-6 h-6" />
              API 設定
            </h2>
            <button 
              type="button"
              onClick={() => setShowSettings(false)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-6">
            {!apiKey && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                請輸入 API Key 以開始辨識
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">選擇服務商</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setProvider('openai')}
                  className={`py-3 px-4 rounded-xl border-2 transition-all font-medium ${
                    provider === 'openai' 
                      ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' 
                      : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                  }`}
                >
                  OpenAI (GPT-4o)
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('gemini')}
                  className={`py-3 px-4 rounded-xl border-2 transition-all font-medium ${
                    provider === 'gemini' 
                      ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' 
                      : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                  }`}
                >
                  Gemini (2.0 Flash)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Key className="w-4 h-4" />
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'openai' ? "sk-..." : "AIza..."}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] transition-all"
              />
              <p className="text-[11px] text-gray-400 mt-2">
                * 金鑰將儲存在您的瀏覽器中，不會上傳至我們的伺服器。
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="w-full py-3.5 bg-[#0A0A0A] text-white rounded-xl font-bold shadow-lg hover:bg-[#2A2A2A] transition-all active:scale-[0.98]"
            >
              儲存並關閉
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[#0A0A0A]">DG Declaration Extractor</h1>
            <p className="text-[#666666] mt-1">AI-powered logistics document processing</p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                console.log("Settings button clicked");
                setShowSettings(true);
              }}
              className="p-2.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all active:scale-95 shadow-sm relative z-[100]"
              title="API Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={processFiles}
              disabled={isProcessing || files.length === 0}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-medium transition-all ${
                isProcessing || files.length === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[#0A0A0A] text-white hover:bg-[#2A2A2A] shadow-lg hover:shadow-xl active:scale-95'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  處理中...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  開始辨識
                </>
              )}
            </button>
            <button
              type="button"
              onClick={exportToExcel}
              disabled={isProcessing || !files.some(f => f.status === 'completed')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-medium transition-all ${
                isProcessing || !files.some(f => f.status === 'completed')
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-[#0A0A0A] border border-gray-200 hover:bg-gray-50 shadow-sm active:scale-95'
              }`}
            >
              <Download className="w-4 h-4" />
              匯出 Excel
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Upload Section */}
          <section className="lg:col-span-1">
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5" />
                上傳單據
              </h2>
              
              <label className="relative group cursor-pointer block">
                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center transition-colors group-hover:border-gray-400 group-hover:bg-gray-50">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <ImageIcon className="w-6 h-6 text-gray-500" />
                  </div>
                  <p className="text-sm font-medium text-gray-700">點擊上傳</p>
                  <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG (最大 10MB)</p>
                </div>
                <input 
                  type="file" 
                  multiple 
                  accept="image/*,application/pdf" 
                  className="hidden" 
                  onChange={onFileChange}
                />
              </label>

              <div className="mt-6 space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {files.map((fileStatus, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 group"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                      {fileStatus.file.type.startsWith('image/') ? (
                        <img src={fileStatus.previewUrl} alt="preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-red-50 text-red-500 text-[10px] font-bold">PDF</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fileStatus.file.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {fileStatus.status === 'processing' && (
                          <span className="text-[10px] text-blue-500 flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" /> 辨識中
                          </span>
                        )}
                        {fileStatus.status === 'completed' && (
                          <span className="text-[10px] text-green-500 flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> 已完成
                          </span>
                        )}
                        {fileStatus.status === 'error' && (
                          <span className="text-[10px] text-red-500 flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" /> 失敗
                          </span>
                        )}
                        {fileStatus.status === 'pending' && (
                          <span className="text-[10px] text-gray-400">待處理</span>
                        )}
                      </div>
                    </div>
                    <button 
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {files.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-8">尚未上傳檔案</p>
                )}
              </div>
            </div>
          </section>

          {/* Results Section */}
          <section className="lg:col-span-2">
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 h-full overflow-hidden flex flex-col">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                辨識結果
              </h2>

              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-gray-100">
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">檔案</th>
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Container No</th>
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">UN NUMBER</th>
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">CLASS</th>
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">SUB CLASS</th>
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">PG</th>
                      <th className="py-3 px-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {files.map((f, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-4 px-4">
                          <p className="text-sm font-medium truncate max-w-[150px]">{f.file.name}</p>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm font-mono text-gray-600">
                            {f.result?.CONTAINER_NUMBER || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm font-mono text-gray-600">
                            {f.result?.UN_NUMBER || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-gray-600">
                            {f.result?.CLASS || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-gray-600">
                            {f.result?.SUB_CLASS || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-gray-600">
                            {f.result?.PACKING_GROUP || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          {f.status === 'completed' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                              成功
                            </span>
                          ) : f.status === 'error' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
                              錯誤
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-400">
                              {f.status === 'processing' ? '處理中' : '等待中'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {files.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-20 text-center text-gray-400 text-sm">
                          辨識結果將顯示於此
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
