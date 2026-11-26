# ⚡ AP-Solver: 3-Section Fullstack & API Challenge AI Copilot

Ek powerful Chrome Extension jo specifically **3-Section Coding Interface** ke questions ko solve karne ke liye banaya gaya hai:
1. **Section 1: QUESTION (Left Pane)** - Question Title, Problem Description, Endpoints Table, Status Codes, aur saare Test Cases ko automatically extract karta hai.
2. **Section 2: CODE (Middle Pane - VS Code Web / Monaco)** - Active file (jaise `src/index.js`, `index.js`, etc.) ka starter code read karta hai aur AI dwara generate kiya gaya accurate solution bina kisi error ke inject karta hai.
3. **Section 3: HTTP REQUEST (Right Pane)** - API tester tool (jaisa aapne bataya yeh user dwara kam use hota hai, isko background me monitor kiya ja sakta hai).
4. **Top Bar: Submit Solution & Grader** - Submission ko automate karta hai, test results track karta hai aur agar koi test case fail hota hai toh **Auto-Retry** se code fix karke dobara submit karta hai!

---

## 🌟 Key Features

- **⚡ One-Click Solve & Submit:** Ek click me Question read karna -> AI solution generate karna -> Editor me code inject karna -> "Submit Solution" press karna -> Test cases monitor karna!
- **🤖 Free AI Models:**
  - **Google Gemini 2.5 Flash / Pro:** 100% Free via [Google AI Studio](https://aistudio.google.com/apikey). High reasoning aur code generation.
  - **Groq Cloud (LLaMA 3.3 70B Versatile):** Ultra-fast (~300 tokens/sec), 100% Free via [Groq Console](https://console.groq.com/keys).
  - **OpenAI / OpenRouter / Custom:** GPT-4o, DeepSeek R1/V3, Claude support.
- **🎯 Full Test-Case Compliance:**
  - Har ek test case (e.g. 1 to 16) ko prompt me enforce karta hai.
  - Sahi status codes (200, 201, 400, 404).
  - Proper error object format: `{ error: "Descriptive message" }`.
  - Native `node:http` vs Express framework compliance (starter code ka framework preserve karta hai).
- **🔁 Auto-Retry with Grader Feedback:** Agar 16 me se 1-2 test cases fail hote hain, toh failing test cases ko AI ke pass bhejkar automatically bug fix karwata hai aur re-submit karta hai (up to 5 attempts).
- **🖥️ VS Code Web / Monaco Multi-Frame Bridge:** Iframe aur webview ke andar running Monaco editor me safe `executeEdits` aur `setValue` ke sath code inject karta hai.
- **👁️ Code Preview & Clipboard Copy:** Generated code ko preview kar sakte hain ya ek click me clipboard pe copy kar sakte hain.

---

## 🚀 Installation Guide (Chrome / Brave / Edge)

1. Open your browser aur address bar me type karein:
   ```
   chrome://extensions/
   ```
2. Top-right corner me **Developer mode** toggle ko **ON** karein.
3. Top-left corner me **Load unpacked** button par click karein.
4. File picker me jaakar is folder ko select karein:
   ```
   /Users/ajayyadav/AP-Solver
   ```
5. Extension successfully install ho jayega aur toolbar me `⚡ AP-Solver` icon dikhega!

---

## 🔑 Free API Key Setup (Only 1 Minute)

Aap dono me se koi bhi FREE API key use kar sakte hain (Credit card nahi chahiye):

### Option A: Google Gemini (Recommended)
1. Go to: [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Apne Google account se sign in karein aur **Create API key** click karein.
3. Key copy karein.
4. Extension ke icon pe click karke **Settings (⚙️)** open karein aur Gemini key paste karke **Save Settings** click karein.

### Option B: Groq Cloud (Super Fast)
1. Go to: [https://console.groq.com/keys](https://console.groq.com/keys)
2. Free account banayein aur **Create API Key** click karein.
3. Extension settings me **Groq API Key** me paste karein.

---

## 💻 How to Use on the Website

1. Newton School / coding platform pe kisi bhi 3-section assignment question ko open karein.
2. Middle section (CODE) me dekhein:
   - Agar "Welcome" screen hai, toh Explorer se apni target file (jaise `src/index.js` ya `index.js`) par click karke open kar lein.
3. Page ke bottom-right corner me aapko ek sleek floating card dikhega:
   **`⚡ AP-Solver: 3-Section Challenge Copilot`**
4. Ab aapke pass 2 options hain:
   - **One-Click Automated:** Direct **`⚡ Solve & Submit Solution`** button dabayein!
     - Extension question aur test cases read karega.
     - Starter code read karega.
     - Best solution generate karega.
     - Code ko editor me inject karega.
     - "Submit Solution" dabayega aur saare test cases pass hone ka wait karega.
   - **Step-by-Step Manual:**
     - **📖 Read Context:** Question aur editor ko verify karein.
     - **🧠 Generate:** Solution generate karein.
     - **👁️ Preview Code:** Generated code dekhein.
     - **✍️ Inject Code:** Editor me insert karein.
     - **🚀 Submit:** Test evaluation run karein.

---

## 📁 Project Structure

```
/Users/ajayyadav/AP-Solver/
├── manifest.json              # MV3 Extension Manifest
├── background.js              # Service Worker (LLM API & multi-frame orchestration)
├── package.json               # Project manifest
├── test_extension.js          # Automated verification script
├── utils/
│   └── llm.js                 # Gemini, Groq & OpenAI integrations & prompt builder
├── content/
│   ├── content.js             # Top-frame scraper, grader tracker, and coordinator
│   ├── solver-ui.js           # Floating glassmorphism Copilot widget UI
│   ├── styles.css             # Dark theme styling matching the platform
│   ├── frame-editor.js        # Content script injected across all iframes
│   └── main-world-bridge.js   # Bridge script for direct window.monaco access
├── popup/
│   ├── popup.html             # Toolbar popup
│   ├── popup.js               # Quick status & API test
│   └── popup.css              # Popup styling
├── options/
│   ├── options.html           # Full settings page
│   ├── options.js             # API keys and preferences manager
│   └── options.css            # Options styling
└── icons/                     # Extension icons (16, 32, 48, 128px)
```

---

## 🧪 Testing

Aap kabhi bhi terminal se extension ki integrity verify kar sakte hain:
```bash
cd /Users/ajayyadav/AP-Solver
npm test
```
Result:
```
✓ manifest.json is valid MV3
✓ All 18 files exist and are non-empty
✓ Code block correctly extracted
✓ Prompt builder generated comprehensive specification
🎉 ALL TESTS PASSED!
```
