"use client";

import { useState } from "react";
import Tesseract from "tesseract.js";


export default function Home() {
  const [imgUrl, setImgUrl] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | done
  const [resultText, setResultText] = useState("");
  const [cleanText, setCleanText] = useState("");
  const [ingredients, setIngredients] = useState([]);
  const [tags, setTags] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [skinRec, setSkinRec] = useState("");
  const [evidence, setEvidence] = useState({});
  const [confidence, setConfidence] = useState(null);



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
  function normalizeText(raw) {
    if (!raw) return "";
    return raw
      .replace(/[•·ㆍ]/g, ",")
      .replace(/\r/g, "\n")
      .replace(/[•·]/g, ",")
      .replace(/[|]/g, ",")
      .replace(/\s+/g, " ")
      .replace(/\n+/g, "\n")
      .trim();
  }
  function getConfidence({ ingredients, tags, rawText }) {
    let score = 0;

    // 성분 개수
    if (ingredients.length >= 15) score += 2;
    else if (ingredients.length >= 8) score += 1;

    // 태그가 잡혔는지
    if (tags.length >= 2) score += 1;

    // OCR 원문 길이
    if ((rawText || "").length >= 120) score += 1;

    if (score >= 4) return { level: "high", msg: "인식 품질이 좋아요 👍" };
    if (score >= 2) return { level: "mid", msg: "대체로 신뢰 가능해요 🙂" };
    return { level: "low", msg: "인식 품질이 낮아요. 사진을 다시 찍어보세요 ⚠️" };
  }


  function isValidIngredientToken(s) {
    if (!s) return false;

    // ✅ 핵심: OCR 이상문자 정규화 + 숨은 문자 제거
    const p = s
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();

    if (p.length < 3) return false;

    // ✅ 라틴 3글자는 전부 노이즈로 간주하고 컷 (IZE, gg?, d?? 등)
    if (/^[A-Za-z]{3}$/.test(p)) return false;

    // 한글 2글자 이상 or 영문 4글자 이상(진짜 성분명 쪽)
    if (!/[가-힣]{2,}|[A-Za-z]{4,}/.test(p)) return false;

    // 반복문자 잡음 컷
    if (/^(.)\1+$/.test(p)) return false;

    return true;
  }


  function extractIngredients(cleanText) {
    // 1) 줄바꿈/쉼표 기준으로 쪼갬
    const rough = cleanText
      .replace(/\n/g, ",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // 2) 괄호/함량/불필요 기호 제거 + 정리
    const cleaned = rough
      .map((s) =>
        s
          .replace(/\(.*?\)/g, "")
          .replace(/[%0-9]/g, "")
          .replace(/[^\p{L}\s-]/gu, "")
          .replace(/\s+/g, " ")
          .trim()
          .normalize("NFKC")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
      )
      .filter(isValidIngredientToken);



    // 3) 중복 제거 (대문자 기준)
    const seen = new Set();
    const uniq = [];
    for (const item of cleaned) {
      const key = item.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(item);
    }
    // 4) 붙어버린 성분 토큰 쪼개기 (v0: 힌트 사전 기반)
    const splitFixed = [];
    for (const token of uniq) {
      // 공백으로 붙은 케이스 먼저 분리
      const partsBySpace = token.split(" ").map(s => s.trim()).filter(Boolean);

      for (const p of partsBySpace) {
        // 힌트가 2개 이상 들어있으면 그걸 기준으로 쪼갬
        const hits = ING_SPLIT_HINTS_KO.filter((h) => p.includes(h));
        if (hits.length <= 1) {
          if (isValidIngredientToken(p)) splitFixed.push(p);
          continue;
        }

        // 긴 힌트부터(세라마이드엔피 vs 세라마이드)
        hits.sort((a, b) => b.length - a.length);

        let rest = p;
        for (const h of hits) {
          // rest 안에 힌트가 있으면 잘라서 넣기
          if (rest.includes(h)) {
            // rest에서 h 앞뒤를 분해하는 단순 방식
            const pieces = rest.split(h);
            // split 결과는 [앞, 뒤] 형태. 앞은 버리고 힌트만 push
            if (isValidIngredientToken(h)) splitFixed.push(h);

            rest = pieces.slice(1).join(h).trim();
          }
        }

        // 남은 찌꺼기가 의미 있으면 남김
        if (isValidIngredientToken(rest)) splitFixed.push(rest);
      }
    }

    // 5) 최종 중복 제거
    const finalSeen = new Set();
    const finalOut = [];
    for (const it of splitFixed) {
      const k = it.toUpperCase();
      if (finalSeen.has(k)) continue;
      finalSeen.add(k);
      finalOut.push(it);
    }

    return finalOut;

  }
  const ING_SPLIT_HINTS_KO = [
    "정제수", "글리세린", "부틸렌글라이콜", "프로필렌글라이콜",
    "나이아신아마이드", "판테놀", "히알루론산", "히알루론산나트륨",
    "세라마이드", "세라마이드엔피", "스쿠알란", "베타인",
    "알로에", "알로에베라잎추출물", "병풀추출물", "아데노신",
    "티트리", "티트리잎오일", "향료", "리날룰", "리모넨"
  ];

  const RULES = [
    {
      tag: "미백",
      keys: [
        "NIACINAMIDE", "나이아신아마이드",
        "ARBUTIN", "알부틴",
        "ASCORBIC", "비타민C", "아스코빅",
        "TRANEXAMIC", "트라넥사믹",
        "GLUTATHIONE", "글루타치온",
      ],
    },
    {
      tag: "주름",
      keys: [
        "RETINOL", "레티놀",
        "RETINAL", "레티날",
        "ADENOSINE", "아데노신",
        "PEPTIDE", "펩타이드",
        "COLLAGEN", "콜라겐",
      ],
    },
    {
      tag: "여드름",
      keys: [
        "SALICYLIC", "살리실릭", "살리실산",
        "BHA", "아젤라익", "아젤라익애씨드",
        "TEA TREE", "티트리",
        "BENZOYL", "벤조일",
      ],
    },
    {
      tag: "수분",
      keys: [
        "GLYCERIN", "글리세린",
        "HYALURON", "히알루론", "히알루론산",
        "PANTHENOL", "판테놀",
        "BETAINE", "베타인",
        "ALOE", "알로에",
      ],
    },
    {
      tag: "장벽",
      keys: [
        "CERAMIDE", "세라마이드",
        "CHOLESTEROL", "콜레스테롤",
        "SQUALANE", "스쿠알란",
        "FATTY ACID", "지방산",
      ],
    },
    {
      tag: "모공/피지",
      keys: [
        "ZINC", "징크", "아연",
        "KAOLIN", "카올린",
        "CLAY", "클레이",
        "NIACINAMIDE", "나이아신아마이드",
      ],
    },
  ];

  const CATEGORY_ORDER = ["미백", "주름", "여드름", "수분", "장벽", "모공/피지"];
  const TAG_STYLES = {
    "미백": { background: "#fff4cc", borderColor: "#f1d06a", color: "#6b4b00" },
    "주름": { background: "#e6f2ff", borderColor: "#7fb3ff", color: "#1f4f7a" },
    "여드름": { background: "#ffe6e1", borderColor: "#ff9a8a", color: "#7a2d22" },
    "수분": { background: "#e6f7f2", borderColor: "#7ad4bf", color: "#1e6154" },
    "장벽": { background: "#eef7d6", borderColor: "#b9d97a", color: "#4a5f18" },
    "모공/피지": { background: "#f0e8ff", borderColor: "#b79cff", color: "#4b2c7a" },
  };

  function getIngredientTag(ingredient) {
    const upper = ingredient.toUpperCase();
    for (const tag of CATEGORY_ORDER) {
      const rule = RULES.find((r) => r.tag === tag);
      if (!rule) continue;
      if (rule.keys.some((k) => upper.includes(k))) return tag;
    }
    return null;
  }

  function getTagCounts(ingredients) {
    const upper = ingredients.map((s) => s.toUpperCase());
    const counts = {};
    for (const tag of CATEGORY_ORDER) counts[tag] = 0;

    for (const rule of RULES) {
      for (const ing of upper) {
        const hit = rule.keys.some((k) => ing.includes(k));
        if (hit) counts[rule.tag] = (counts[rule.tag] || 0) + 1;
      }
    }

    return counts;
  }

  const WARN_KEYS = [
    { label: "향료/알러젠 가능", keys: ["FRAGRANCE", "PARFUM", "향료", "리모넨", "리날룰", "시트로넬롤", "제라니올"] },
    { label: "알코올 주의", keys: ["ALCOHOL", "DENAT", "에탄올", "변성알코올", "알코올"] },
    { label: "에센셜오일/향추출물 가능", keys: ["LAVENDER", "라벤더", "로즈마리", "유칼립투스", "페퍼민트", "시트러스", "오렌지"] },
  ];


  function tagFeatures(ingredients) {
    const upper = ingredients.map((s) => s.toUpperCase());

    const tags = new Set();
    const evidence = {}; // tag -> matched keys

    for (const rule of RULES) {
      for (const ing of upper) {
        for (const key of rule.keys) {
          if (ing.includes(key)) {
            tags.add(rule.tag);
            if (!evidence[rule.tag]) evidence[rule.tag] = new Set();
            evidence[rule.tag].add(key);
          }
        }
      }
    }

    // warnings
    const warnings = [];
    for (const w of WARN_KEYS) {
      const hit = upper.some((ing) => w.keys.some((k) => ing.includes(k)));
      if (hit) warnings.push(w.label);
    }

    // evidence Set -> Array
    const evidenceOut = {};
    for (const [k, v] of Object.entries(evidence)) {
      evidenceOut[k] = Array.from(v);
    }

    return { tags: Array.from(tags), evidence: evidenceOut, warnings };
  }

  function recommendSkinType(tags, ingredients, warnings) {
    const upper = ingredients.map((s) => s.toUpperCase());
    const hasHydration = tags.includes("수분") || tags.includes("장벽");
    const heavyOcclusive = upper.some((s) => s.includes("SHEA") || s.includes("BUTTER") || s.includes("COCONUT"));
    const hasAcneActives = tags.includes("여드름");
    const hasOilControl = tags.includes("모공/피지");

    // 아주 v0 룰
    if (hasHydration && !heavyOcclusive && hasOilControl) return "수부지 추천 (수분/장벽 + 피지 밸런스)";
    if (hasHydration && heavyOcclusive) return "건성/장벽 약한 피부 추천 (보습·오클루시브 성향)";
    if (hasOilControl && !heavyOcclusive) return "지성/복합성 추천 (가벼운 사용감 가능성)";
    if (hasAcneActives) return "여드름/트러블 피부에 시도 가치 (자극 가능성은 주의)";

    // 기본값
    if (warnings.length) return "민감 피부는 주의 성분 확인 추천";
    return "대체로 무난 (사진 품질/성분 추출 정확도에 따라 달라질 수 있음)";
  }

  async function startAnalyze() {
    if (!imgFile) return;

    setStatus("loading");
    setResultText("");
    setCleanText("");
    setIngredients([]);
    setTags([]);
    setEvidence({});
    setWarnings([]);
    setSkinRec("");


    try {
      const preprocessed = await preprocessImage(imgFile);
      const { data } = await Tesseract.recognize(preprocessed, "kor+eng", {
        tessedit_pageseg_mode: 6,
      });

      const text = (data?.text || "").trim();

      // ✅ Day4: 파이프라인 실행
      const clean = normalizeText(text);
      const ing = extractIngredients(clean);
      const { tags: t, evidence: ev, warnings: w } = tagFeatures(ing);
      const rec = recommendSkinType(t, ing, w);

      // ✅ 화면에 쓰려고 state 저장
      setCleanText(clean);
      setIngredients(ing);
      setTags(t);
      setEvidence(ev);
      setWarnings(w);
      setSkinRec(rec);
      const conf = getConfidence({
        ingredients: ing,
        tags: t,
        rawText: text,
      });
      setConfidence(conf);


      setStatus("done");
      setResultText(
        text
          ? text
          : "텍스트를 거의 인식하지 못했어요. 더 밝고 선명한 사진으로 다시 시도해보세요."
      );
    } catch (err) {
      console.error(err);

      // ✅ 에러 났을 때도 상태 초기화(깔끔)
      setCleanText("");
      setIngredients([]);
      setTags([]);
      setEvidence({});
      setWarnings([]);
      setSkinRec("");
      setConfidence(null);


      setStatus("done");
      setResultText("OCR 실패. 콘솔 에러를 확인해 주세요.");
    }
  }


    return (
      <main
        style={{
          padding: "clamp(16px, 3vw, 28px)",
          fontFamily: "system-ui",
          maxWidth: "min(920px, 100%)",
          width: "100%",
          backgroundColor: "#ffffff",
          color: "#111111",
          minHeight: "100vh",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ marginBottom: 8 }}>INCI Scout</h1>
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
                maxWidth: "min(560px, 100%)",
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
          {status === "done" && confidence && (
          <section
            style={{
              marginTop: 16,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background:
                confidence.level === "high"
                  ? "#e8f5e9"
                  : confidence.level === "mid"
                    ? "#fffde7"
                    : "#fff3cd",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {confidence.msg}
            {confidence.level === "low" && (
              <div style={{ fontWeight: 400, marginTop: 4, opacity: 0.8 }}>
                · 글자가 선명하게 보이도록 밝은 곳에서 찍어주세요<br />
                · 성분표 전체가 프레임 안에 들어오게 해주세요
              </div>
            )}
          </section>
        )}

        {/* 결과 */}
        {status === "done" && ingredients.length > 0 && (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>성분 추출</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, width: "100%" }}>
              {ingredients.slice(0, 60).map((it) => {
                const tag = getIngredientTag(it);
                const chipStyle = tag ? TAG_STYLES[tag] : null;
                return (
                  <span
                    key={it}
                    title={tag ? `${tag} 관련 성분` : undefined}
                    style={{
                      border: "1px solid",
                      borderColor: chipStyle?.borderColor || "#ddd",
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      background: chipStyle?.background || "white",
                      color: chipStyle?.color || "#111111",
                    }}
                  >
                    {it}
                  </span>
                );
              })}
            </div>
            {ingredients.length > 60 && (
              <p style={{ fontSize: 12, opacity: 0.7 }}>너무 길어서 60개까지만 표시 중</p>
            )}
          </section>
        )}
        {status === "done" && (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>기능 태그</h2>
            {tags.length === 0 ? (
              <p style={{ opacity: 0.7 }}>아직 태그를 못 잡았어요. (사진 품질/성분 인식 문제일 수 있음)</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tags.map((t) => {
                  const chipStyle = TAG_STYLES[t];
                  return (
                    <span
                      key={t}
                      style={{
                        border: "1px solid",
                        borderColor: chipStyle?.borderColor || "#ddd",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        background: chipStyle?.background || "white",
                        color: chipStyle?.color || "#111111",
                      }}
                    >
                      {t}
                      {evidence?.[t]?.length ? (
                        <span style={{ opacity: 0.8, fontWeight: 400 }}>
                          {" "}
                          · {evidence[t].join(", ")}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            )}
          </section>
        )}
        {status === "done" && ingredients.length > 0 && (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>피부타입 다이어그램</h2>
            {(() => {
              const counts = getTagCounts(ingredients);
              const values = CATEGORY_ORDER.map((t) => counts[t] || 0);
              const maxValue = Math.max(1, ...values);
              const size = 240;
              const center = size / 2;
              const radius = size * 0.36;
              const angleStep = (Math.PI * 2) / CATEGORY_ORDER.length;

              function pointAt(idx, r) {
                const angle = -Math.PI / 2 + idx * angleStep;
                const x = center + r * Math.cos(angle);
                const y = center + r * Math.sin(angle);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }

              const gridLevels = [0.33, 0.66, 1];
              const outlinePoints = CATEGORY_ORDER.map((_, i) => pointAt(i, radius)).join(" ");
              const valuePoints = values
                .map((v, i) => pointAt(i, (v / maxValue) * radius))
                .join(" ");

              return (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    {gridLevels.map((lv) => (
                      <polygon
                        key={lv}
                        points={CATEGORY_ORDER.map((_, i) => pointAt(i, radius * lv)).join(" ")}
                        fill="none"
                        stroke="#e5e5e5"
                        strokeWidth="1"
                      />
                    ))}
                    {CATEGORY_ORDER.map((_, i) => (
                      <line
                        key={`axis-${i}`}
                        x1={center}
                        y1={center}
                        x2={parseFloat(pointAt(i, radius).split(",")[0])}
                        y2={parseFloat(pointAt(i, radius).split(",")[1])}
                        stroke="#e5e5e5"
                        strokeWidth="1"
                      />
                    ))}
                    <polygon points={outlinePoints} fill="none" stroke="#cfcfcf" strokeWidth="1.5" />
                    <polygon
                      points={valuePoints}
                      fill="rgba(55, 125, 255, 0.18)"
                      stroke="rgba(55, 125, 255, 0.65)"
                      strokeWidth="2"
                    />
                    {CATEGORY_ORDER.map((t, i) => {
                      const angle = -Math.PI / 2 + i * angleStep;
                      const labelRadius = radius + 18;
                      const x = center + labelRadius * Math.cos(angle);
                      const y = center + labelRadius * Math.sin(angle);
                      return (
                        <text
                          key={`label-${t}`}
                          x={x}
                          y={y}
                          fontSize="11"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#444"
                        >
                          {t}
                        </text>
                      );
                    })}
                  </svg>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      maxWidth: 300,
                    }}
                  >
                    {CATEGORY_ORDER.map((t) => {
                      const chipStyle = TAG_STYLES[t];
                      return (
                        <span
                          key={`count-${t}`}
                          style={{
                            border: "1px solid",
                            borderColor: chipStyle?.borderColor || "#ddd",
                            padding: "4px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            background: chipStyle?.background || "white",
                            color: chipStyle?.color || "#111111",
                          }}
                        >
                          {t} {counts[t] || 0}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </section>
        )}
        {status === "done" && (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>피부타입 추천</h2>
            <p style={{ marginTop: 0 }}>{skinRec}</p>

            {warnings.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>주의</h3>
                <ul>
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>
    );
  }
