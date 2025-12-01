# Lec2KR (Lecture to Korean) 🎓🇰🇷

**Lec2KR** is a Chrome Extension that provides real-time, context-aware Korean translations for English technical lectures on platforms like **DeepLearning.AI** and **Coursera**.

Powered by **Google Gemini API** (Gemini 2.0 Flash Lite), it ensures natural translations for technical content by considering the surrounding context of the transcript.

## ✨ Key Features

*   **Real-time Translation**: Displays Korean subtitles overlaid on the video player.
*   **Context-Aware**: Translates based on previous and future sentences to maintain flow and handle technical terms correctly.
*   **Full Transcript Translation**: Automatically translates the entire lecture transcript in the background for seamless playback.
*   **Export Support**:
    *   **Export EN**: Download the original English transcript.
    *   **Export KR**: Download the fully translated Korean transcript.
*   **Speed Modes**:
    *   **Stable**: Sequential processing for maximum reliability.
    *   **Fast**: Parallel processing for rapid translation (Recommended).
*   **Draggable UI**: Position the subtitle overlay anywhere on the screen.

## 🚀 Installation

1.  Clone or download this repository.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** (top right toggle).
4.  Click **Load unpacked**.
5.  Select the `Lec2KR` folder.

## 🛠 Usage

1.  Click the extension icon in the Chrome toolbar.
2.  Enter your **Gemini API Key** (Get one from [Google AI Studio](https://aistudio.google.com/)).
3.  Select your preferred **Translation Speed** (Fast recommended).
4.  Click **Save Settings**.
5.  Navigate to a lecture on DeepLearning.AI or Coursera.
6.  The overlay will appear automatically.
    *   **Status**: Shows translation progress (e.g., "Translating... 45%").
    *   **Export**: Use the `EN` / `KR` buttons in the overlay header to download scripts.

## 🔧 Technology Stack

*   **Manifest V3**: Modern Chrome Extension architecture.
*   **Google Gemini API**: Uses `gemini-2.0-flash-lite` for high-speed, cost-effective translation.
*   **Vanilla JS**: Lightweight implementation without heavy frameworks.

## 📝 License

MIT License
