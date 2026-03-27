import { GoogleGenAI, Type } from "@google/genai";

let currentApiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = currentApiKey ? new GoogleGenAI({ apiKey: currentApiKey }) : null;

export const setGeminiApiKey = (key: string) => {
  currentApiKey = key;
  ai = key ? new GoogleGenAI({ apiKey: key }) : null;
};

export const getGeminiApiKey = () => currentApiKey;

export const searchWingetApp = async (query: string) => {
  const performAiSearch = async () => {
    if (!ai) {
      const isWindows = /win32/i.test(process.platform) || (typeof window !== 'undefined' && /Win/i.test(navigator.platform));
      const envName = isWindows ? "Windows" : "Linux";
      console.warn(`Gemini API Key is missing and local winget search failed in this environment (${envName}). Providing sample results for testing.`);
      return [
        { name: "Google Chrome", id: "Google.Chrome", version: "122.0.6261.129", moniker: "chrome", source: 'mock' },
        { name: "Visual Studio Code", id: "Microsoft.VisualStudioCode", version: "1.87.2", moniker: "vscode", source: 'mock' },
        { name: "Notepad++", id: "Notepad++.Notepad++", version: "8.6.4", moniker: "notepadplusplus", source: 'mock' },
        { name: "Mozilla Firefox", id: "Mozilla.Firefox", version: "123.0.1", moniker: "firefox", source: 'mock' },
        { name: "Git", id: "Git.Git", version: "2.44.0", moniker: "git", source: 'mock' }
      ];
    }
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the best winget package for: "${query}". Return a JSON array of objects with keys: name, id, version, moniker. Provide at least 3 relevant results.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              id: { type: Type.STRING },
              version: { type: Type.STRING },
              moniker: { type: Type.STRING }
            },
            required: ["name", "id", "version", "moniker"]
          }
        }
      }
    });
    const results = JSON.parse(response.text);
    return results.map((r: any) => ({ ...r, source: 'ai' }));
  };

  try {
    const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error("Failed to search apps via pwsh");
    const results = await response.json();

    // Fallback to AI if no results found via pwsh
    if (results.length === 0) {
      console.log("No results via pwsh, falling back to AI search...");
      return performAiSearch();
    }

    return results.map((r: any) => ({ ...r, source: r.source || 'winget' }));
  } catch (err) {
    console.warn("Search via pwsh failed, falling back to AI search:", err);
    return performAiSearch();
  }
};

export const modifyPsadtScript = async (script: string, request: string) => {
  if (!ai) {
    console.warn("Gemini API Key is missing. AI script modification is unavailable.");
    return script + "\n\n# [AI Modification Unavailable: Please add a Gemini API Key in Settings to enable this feature]";
  }
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a professional PSADT expert. Modify the following PowerShell script based on this request: "${request}".\n\nScript:\n${script}\n\nReturn ONLY the modified script code.`,
  });
  return response.text;
};

export const chatWithPsadtAssistant = async (
  script: string,
  history: { role: string; content: string }[],
  request: string
): Promise<{ text: string; isScript: boolean }> => {
  if (!ai) {
    return { text: "Gemini API Key is missing. Add it in Azure Setup to enable AI assistance.", isScript: false };
  }

  const historyContext = history.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n\n');

  const prompt = `You are a professional PSADT (PowerShell App Deployment Toolkit) expert assistant.

Current script:
${script}

${historyContext ? `Conversation so far:\n${historyContext}\n\n` : ''}User: ${request}

Rules:
- If the user asks you to modify the script, return ONLY the complete modified script code with no explanation.
- If the user asks a question or wants an explanation, respond with a helpful text answer.
- Never wrap code in markdown code blocks.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const text = response.text;
  const isScript = text.includes('$adtSession') || text.includes('Invoke-AppDeployToolkit') ||
    (text.includes('$scriptPayload') && text.includes('Install-WinGetPackage'));

  return { text, isScript };
};
