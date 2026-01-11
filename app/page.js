"use client";

import { useState } from "react";
import Tesseract from "tesseract.js";


export default function Home() {
  const [imgUrl, setImgUrl] = useState(null);

  const [imgFile, setImgFile] = useState(null); 


  // Day2 추가: 상태 + 결과
  const [status, setStatus] = useState("idle"); // idle | loading | done
  const [resultText, setResultText] = useState("");

  const canAnalyze = !!imgFile && status == "idle";

  async function preprocessImage(file) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise((r) => (img.onload = r));

    const scale = 2.5; // 2~3 추천
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    const ctx = canvas.getContext("2d");

    // 확대해서 그리기
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 흑백 + 대비(간단 임계값)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // threshold (값 조절 가능: 150~200)
      const v = gray > 170 ? 255 : 0;

      d[i] = d[i + 1] = d[i + 2] = v;
    }

    ctx.putImageData(imageData, 0, 0);

    // blob으로 반환
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );

    return blob;
  }

  async function startAnalyze() {
    if (!imgFile) return;

    setStatus("loading");
    setResultText("");

    try {
      const preprocessed = await preprocessImage(imgFile);
      const { data } = await Tesseract.recognize(preprocessed, "kor+eng", {
        tessedit_pageseg_mode: 6, // 블록 텍스트에 자주 유리
      });

      const text = (data?.text || "").trim();

      setStatus("done");
      setResultText(text ? text : "텍스트를 거의 인식하지 못했어요. 더 밝고 선명한 사진으로 다시 시도해보세요.");
    } catch (err) {
      console.error(err);
      setStatus("done");
      setResultText("OCR 실패. 콘솔 에러를 확인해 주세요.");
    }
  }


  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui",
        maxWidth: 560,
        backgroundColor: "#ffffff",
        color: "#111111",
        minHeight: "100vh",
      }}
    > 
      <h1 style={{ marginBottom: 8 }}>INCI Scout</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Day 2: 버튼을 누르면 분석 흐름(로딩 → 결과)이 동작하게 만들기
      </p>

      {/* 업로드 */}
      <div style={{ marginTop: 16 }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setImgFile(file);
            const url = URL.createObjectURL(file);
            setImgUrl(url);

            // 새 이미지를 올리면 결과 초기화
            setStatus("idle");
            setResultText("");
          }}
        />
      </div>

      {/* 미리보기 */}
      {imgUrl && (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>미리보기</h2>
          <img
            src={imgUrl}
            alt="preview"
            style={{
              maxWidth: 420,
              width: "100%",
              borderRadius: 12,
              border: "1px solid #ddd",
            }}
          />
        </section>
      )}

      {/* 분석 버튼 */}
      <div style={{ marginTop: 16 }}>
        <button
          onClick={startAnalyze}
          disabled={!canAnalyze}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background:
              status === "done"
                ? "#e8f5e9"
                : status === "loading"
                  ? "#fff3cd"
                  : "white",
            color: "#111111",
            cursor: canAnalyze ? "pointer" : "not-allowed",
            fontWeight: 600,
          }}

        >
          {
          status === "loading"
            ? "분석 중..."
            : status === "done"
            ? "분석 완료!"
            : "분석 시작"
          }
        </button>

        {!imgUrl && (
          <span style={{ marginLeft: 10, opacity: 0.6, fontSize: 13 }}>
            먼저 사진을 업로드하세요
          </span>
        )}
      </div>

      {/* 결과 */}
      {status === "done" && (
        <section
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "#fafafa",
            whiteSpace: "pre-line",
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>결과</h2>
          <p style={{ marginBottom: 0 }}>{resultText}</p>
        </section>
      )}
    </main>
  );
}
