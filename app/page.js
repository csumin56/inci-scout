"use client";

import { useState } from "react";

export default function Home() {
  const [imgUrl, setImgUrl] = useState(null);

  // Day2 추가: 상태 + 결과
  const [status, setStatus] = useState("idle"); // idle | loading | done
  const [resultText, setResultText] = useState("");

  const canAnalyze = !!imgUrl && status !== "loading";

  function startAnalyze() {
    if (!imgUrl) return;

    setStatus("loading");
    setResultText("");

    // "가짜 분석" (OCR 붙이기 전 연습)
    setTimeout(() => {
      setStatus("done");
      setResultText(
        "분석 완료 ✅\n(가짜 결과) 수분/장벽 계열 성분이 포함된 것으로 보입니다.\n내일 OCR을 붙이면 진짜로 바뀝니다."
      );
    }, 1500);
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
            background: canAnalyze ? "white" : "#f2f2f2",
            color: "#111111",
            cursor: canAnalyze ? "pointer" : "not-allowed",
            fontWeight: 600,
          }}
        >
          {status === "loading" ? "분석 중..." : "분석 시작"}
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
