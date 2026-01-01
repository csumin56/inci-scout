"use client";

import { useState } from "react";

export default function Home() {
  const [imgUrl, setImgUrl] = useState(null);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>INCI Scout</h1>
      <p style={{ opacity: 0.7 }}>
        성분표 사진을 올리면 미리보기가 뜹니다.
      </p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          const url = URL.createObjectURL(file);
          setImgUrl(url);
        }}
      />

      {imgUrl && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16 }}>미리보기</h2>
          <img
            src={imgUrl}
            alt="preview"
            style={{
              maxWidth: 360,
              width: "100%",
              borderRadius: 12,
              border: "1px solid #ddd",
            }}
          />
        </div>
      )}
    </main>
  );
}
