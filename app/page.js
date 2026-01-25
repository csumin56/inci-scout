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

  // OCR 인식률을 높이기 위한 이미지 전처리
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
  // OCR 결과를 성분 파싱에 맞게 정규화
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
  // 인식 품질을 간단 스코어로 판단
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


  // OCR 잡음 제거용 간단 필터
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


  // 텍스트에서 성분 리스트를 추출/정리
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
  // 붙어버린 한글 성분 토큰 분리 힌트
  const ING_SPLIT_HINTS_KO = [
    "정제수", "글리세린", "부틸렌글라이콜", "프로필렌글라이콜",
    "나이아신아마이드", "판테놀", "히알루론산", "히알루론산나트륨",
    "세라마이드", "세라마이드엔피", "스쿠알란", "베타인",
    "알로에", "알로에베라잎추출물", "병풀추출물", "아데노신",
    "티트리", "티트리잎오일", "향료", "리날룰", "리모넨"
  ];

  // 성분 매칭 카테고리 순서
  const CATEGORY_ORDER = ["미백", "주름", "여드름", "수분", "장벽", "모공/피지"];
  // 카테고리별 성분 키워드(한/영)
  const CATEGORY_KEYS = {
    "미백": [
      "나이아신아마이드", "NIACINAMIDE",
      "알부틴", "ARBUTIN",
      "알파-알부틴", "ALPHA-ARBUTIN",
      "데옥시아르부틴", "DEOXYARBUTIN",
      "코직애씨드", "KOJIC ACID",
      "코직다이팔미테이트", "KOJIC DIPALMITATE",
      "아스코빅애씨드", "ASCORBIC ACID",
      "아스코빌글루코사이드", "ASCORBYL GLUCOSIDE",
      "마그네슘아스코빌포스페이트", "MAGNESIUM ASCORBYL PHOSPHATE",
      "소듐아스코빌포스페이트", "SODIUM ASCORBYL PHOSPHATE",
      "에틸아스코빅애씨드", "ETHYL ASCORBIC ACID",
      "테트라헥실데실아스코베이트", "TETRAHEXYLDECYL ASCORBATE",
      "아스코빌팔미테이트", "ASCORBYL PALMITATE",
      "아스코빌테트라이소팔미테이트", "ASCORBYL TETRAISOPALMITATE",
      "트라넥사믹애씨드", "TRANEXAMIC ACID",
      "글루타치온", "GLUTATHIONE",
      "디포타슘글리시리제이트", "DIPOTASSIUM GLYCYRRHIZATE",
      "감초뿌리추출물", "GLYCYRRHIZA GLABRA ROOT EXTRACT",
      "상백피추출물", "MORUS ALBA ROOT EXTRACT",
      "베어베리잎추출물", "UVA URSI LEAF EXTRACT",
      "페닐에틸레조르시놀", "PHENYLETHYL RESORCINOL",
      "헥실레조르시놀", "HEXYLRESORCINOL",
      "N-아세틸글루코사민", "N-ACETYL GLUCOSAMINE",
      "운데실레노일페닐알라닌", "UNDECYLEN OYL PHENYLALANINE",
      "쌀겨추출물", "ORYZA SATIVA BRAN EXTRACT",
      "진주추출물", "PEARL EXTRACT",
      "석류추출물", "PUNICA GRANATUM EXTRACT",
      "레몬추출물", "CITRUS LIMON FRUIT EXTRACT",
      "유자추출물", "CITRUS JUNOS FRUIT EXTRACT",
      "녹차추출물", "CAMELLIA SINENSIS LEAF EXTRACT",
    ],
    "주름": [
      "레티놀", "RETINOL",
      "레티날", "RETINAL",
      "레티닐팔미테이트", "RETINYL PALMITATE",
      "레티닐아세테이트", "RETINYL ACETATE",
      "레티닐프로피오네이트", "RETINYL PROPIONATE",
      "레티닐레티노에이트", "RETINYL RETINOATE",
      "하이드록시피나콜론레티노에이트", "HYDROXYPINACOLONE RETINOATE",
      "바쿠치올", "BAKUCHIOL",
      "아데노신", "ADENOSINE",
      "팔미토일트라이펩타이드", "PALMITOYL TRIPEPTIDE",
      "팔미토일테트라펩타이드", "PALMITOYL TETRAPEPTIDE",
      "팔미토일펜타펩타이드", "PALMITOYL PENTAPEPTIDE",
      "아세틸헥사펩타이드", "ACETYL HEXAPEPTIDE",
      "아세틸테트라펩타이드", "ACETYL TETRAPEPTIDE",
      "아세틸옥타펩타이드", "ACETYL OCTAPEPTIDE",
      "카퍼트라이펩타이드", "COPPER TRIPEPTIDE",
      "트라이펩타이드", "TRIPEPTIDE",
      "헥사펩타이드", "HEXAPEPTIDE",
      "디펩타이드다이아미노부티로일벤질아마이드다이아세테이트", "DIPEPTIDE DIAMINOBUTYROYL BENZYLAMIDE DIACETATE",
      "콜라겐", "COLLAGEN",
      "하이드롤라이즈드콜라겐", "HYDROLYZED COLLAGEN",
      "엘라스틴", "ELASTIN",
      "하이드롤라이즈드엘라스틴", "HYDROLYZED ELASTIN",
      "유비퀴논", "UBIQUINONE",
      "레스베라트롤", "RESVERATROL",
      "페룰릭애씨드", "FERULIC ACID",
      "토코페롤", "TOCOPHEROL",
      "달팽이점액여과물", "SNAIL SECRETION FILTRATE",
      "아스타잔틴", "ASTAXANTHIN",
    ],
    "여드름": [
      "살리실산", "SALICYLIC ACID",
      "카프릴로일살리실릭애씨드", "CAPRYLOYL SALICYLIC ACID",
      "베타인살리실레이트", "BETAINE SALICYLATE",
      "글라이콜릭애씨드", "GLYCOLIC ACID",
      "락틱애씨드", "LACTIC ACID",
      "만델릭애씨드", "MANDELIC ACID",
      "말릭애씨드", "MALIC ACID",
      "시트릭애씨드", "CITRIC ACID",
      "아젤라익애씨드", "AZELAIC ACID",
      "벤조일퍼옥사이드", "BENZOYL PEROXIDE",
      "티트리잎오일", "TEA TREE LEAF OIL",
      "티트리잎추출물", "TEA TREE LEAF EXTRACT",
      "어성초추출물", "HOUTTUYNIA CORDATA EXTRACT",
      "병풀추출물", "CENTELLA ASIATICA EXTRACT",
      "마데카소사이드", "MADECASSOSIDE",
      "아시아티코사이드", "ASIATICOSIDE",
      "마데카식애씨드", "MADECASSIC ACID",
      "아시아틱애씨드", "ASIATIC ACID",
      "판테놀", "PANTHENOL",
      "알로에베라잎추출물", "ALOE BARBADENSIS LEAF EXTRACT",
      "프로폴리스추출물", "PROPOLIS EXTRACT",
      "녹차추출물", "CAMELLIA SINENSIS LEAF EXTRACT",
      "로즈마리잎추출물", "ROSEMARY LEAF EXTRACT",
      "자몽추출물", "CITRUS PARADISI FRUIT EXTRACT",
      "글루코노락톤", "GLUCONOLACTONE",
      "락토바이오닉애씨드", "LACTOBIONIC ACID",
      "황", "SULFUR",
      "징크PCA", "ZINC PCA",
      "징크글루코네이트", "ZINC GLUCONATE",
      "알란토인", "ALLANTOIN",
    ],
    "수분": [
      "글리세린", "GLYCERIN",
      "부틸렌글라이콜", "BUTYLENE GLYCOL",
      "프로필렌글라이콜", "PROPYLENE GLYCOL",
      "프로판다이올", "PROPANEDIOL",
      "펜틸렌글라이콜", "PENTYLENE GLYCOL",
      "베타인", "BETAINE",
      "알로에베라잎즙", "ALOE BARBADENSIS LEAF JUICE",
      "히알루론산", "HYALURONIC ACID",
      "소듐하이알루로네이트", "SODIUM HYALURONATE",
      "하이드롤라이즈드하이알루로닉애씨드", "HYDROLYZED HYALURONIC ACID",
      "소듐아세틸레이티드하이알루로네이트", "SODIUM ACETYLATED HYALURONATE",
      "베타-글루칸", "BETA-GLUCAN",
      "트레할로스", "TREHALOSE",
      "소듐PCA", "SODIUM PCA",
      "PCA", "PCA",
      "소듐락테이트", "SODIUM LACTATE",
      "유레아", "UREA",
      "소르비톨", "SORBITOL",
      "자일리톨", "XYLITOL",
      "글루코오스", "GLUCOSE",
      "프럭토오스", "FRUCTOSE",
      "헥산다이올", "HEXANEDIOL",
      "디프로필렌글라이콜", "DIPROPYLENE GLYCOL",
      "글리세레스-26", "GLYCERETH-26",
      "하이드록시에틸우레아", "HYDROXYETHYL UREA",
      "스클레로튬검", "SCLEROTIUM GUM",
      "폴리글리세린", "POLYGLYCERIN",
      "에틸헥실글리세린", "ETHYLHEXYLGLYCERIN",
      "소듐폴리글루타메이트", "SODIUM POLYGLUTAMATE",
    ],
    "장벽": [
      "세라마이드엔피", "CERAMIDE NP",
      "세라마이드에이피", "CERAMIDE AP",
      "세라마이드이오피", "CERAMIDE EOP",
      "세라마이드엔에스", "CERAMIDE NS",
      "세라마이드에이에스", "CERAMIDE AS",
      "세라마이드이오에스", "CERAMIDE EOS",
      "판테놀", "PANTHENOL",
      "콜레스테롤", "CHOLESTEROL",
      "스쿠알란", "SQUALANE",
      "스쿠알렌", "SQUALENE",
      "피토스핑고신", "PHYTOSPHINGOSINE",
      "스핑고신", "SPHINGOSINE",
      "리놀레익애씨드", "LINOLEIC ACID",
      "리놀렌익애씨드", "LINOLENIC ACID",
      "올레익애씨드", "OLEIC ACID",
      "팔미틱애씨드", "PALMITIC ACID",
      "스테아릭애씨드", "STEARIC ACID",
      "미리스틱애씨드", "MYRISTIC ACID",
      "베헤닉애씨드", "BEHENIC ACID",
      "하이드로제네이티드레시틴", "HYDROGENATED LECITHIN",
      "레시틴", "LECITHIN",
      "글리세릴스테아레이트", "GLYCERYL STEARATE",
      "세틸알코올", "CETYL ALCOHOL",
      "스테아릴알코올", "STEARYL ALCOHOL",
      "시어버터", "BUTYROSPERMUM PARKII BUTTER",
      "마카다미아씨오일", "MACADAMIA TERNIFOLIA SEED OIL",
      "호호바씨오일", "SIMMONDSIA CHINENSIS SEED OIL",
      "아르간커넬오일", "ARGANIA SPINOSA KERNEL OIL",
      "아보카도오일", "PERSEA GRATISSIMA OIL",
      "해바라기씨오일", "HELIANTHUS ANNUUS SEED OIL",
      "올리브오일", "OLEA EUROPAEA FRUIT OIL",
    ],
    "모공/피지": [
      "징크PCA", "ZINC PCA",
      "징크글루코네이트", "ZINC GLUCONATE",
      "징크옥사이드", "ZINC OXIDE",
      "징크설페이트", "ZINC SULFATE",
      "카올린", "KAOLIN",
      "벤토나이트", "BENTONITE",
      "일라이트", "ILLITE",
      "몬모릴로나이트", "MONTMORILLONITE",
      "실리카", "SILICA",
      "실리카디메틸실릴레이트", "SILICA DIMETHYL SILYLATE",
      "탤크", "TALC",
      "차콜", "CHARCOAL",
      "마그네슘알루미늄실리케이트", "MAGNESIUM ALUMINUM SILICATE",
      "알루미늄전분옥테닐석시네이트", "ALUMINUM STARCH OCTENYLSUCCINATE",
      "폴리메틸실세스퀴옥세인", "POLYMETHYL SILSESQUIOXANE",
      "폴리메틸메타크릴레이트", "POLYMETHYL METHACRYLATE",
      "나이아신아마이드", "NIACINAMIDE",
      "위치하젤잎추출물", "HAMAMELIS VIRGINIANA LEAF EXTRACT",
      "로즈마리잎추출물", "ROSEMARY LEAF EXTRACT",
      "살비아잎추출물", "SALVIA OFFICINALIS LEAF EXTRACT",
      "페퍼민트잎추출물", "MENTHA PIPERITA LEAF EXTRACT",
      "녹차추출물", "CAMELLIA SINENSIS LEAF EXTRACT",
      "쑥추출물", "ARTEMISIA PRINCEPS EXTRACT",
      "칼라민", "CALAMINE",
      "규조토", "DIATOMACEOUS EARTH",
      "제올라이트", "ZEOLITE",
      "탄산칼슘", "CALCIUM CARBONATE",
      "탄산마그네슘", "MAGNESIUM CARBONATE",
      "마이카", "MICA",
      "알루미나", "ALUMINA",
    ],
  };

  // 태그 판별용 룰로 변환
  const RULES = CATEGORY_ORDER.map((tag) => ({
    tag,
    keys: CATEGORY_KEYS[tag] || [],
  }));
  // 카테고리별 UI 컬러 스타일
  const TAG_STYLES = {
    "미백": { background: "#fff4cc", borderColor: "#f1d06a", color: "#6b4b00" },
    "주름": { background: "#e6f2ff", borderColor: "#7fb3ff", color: "#1f4f7a" },
    "여드름": { background: "#ffe6e1", borderColor: "#ff9a8a", color: "#7a2d22" },
    "수분": { background: "#e6f7f2", borderColor: "#7ad4bf", color: "#1e6154" },
    "장벽": { background: "#eef7d6", borderColor: "#b9d97a", color: "#4a5f18" },
    "모공/피지": { background: "#f0e8ff", borderColor: "#b79cff", color: "#4b2c7a" },
  };

  // 성분이 어떤 카테고리에 속하는지 판별
  function getIngredientTag(ingredient) {
    const upper = ingredient.toUpperCase();
    for (const tag of CATEGORY_ORDER) {
      const rule = RULES.find((r) => r.tag === tag);
      if (!rule) continue;
      if (rule.keys.some((k) => upper.includes(k))) return tag;
    }
    return null;
  }

  // 카테고리별 성분 개수 집계
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

  // 주의 성분 탐지 키워드
  const WARN_KEYS = [
    { label: "향료/알러젠 가능", keys: ["FRAGRANCE", "PARFUM", "향료", "리모넨", "리날룰", "시트로넬롤", "제라니올"] },
    { label: "알코올 주의", keys: ["ALCOHOL", "DENAT", "에탄올", "변성알코올", "알코올"] },
    { label: "에센셜오일/향추출물 가능", keys: ["LAVENDER", "라벤더", "로즈마리", "유칼립투스", "페퍼민트", "시트러스", "오렌지"] },
  ];


  // 기능 태그/근거/주의 성분 추출
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

  // 태그 조합으로 간단 피부타입 추천
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

  // OCR 파이프라인 실행
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
        tessedit_pageseg_mode: 4,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
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
        <h1
          style={{
            marginBottom: 8,
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            color: "#1f5fbf",
            letterSpacing: "-0.5px",
          }}
        >
          INCI Scout
        </h1>
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
              const size = 260;
              const center = size / 2;
              const radius = size * 0.38;
              const angleStep = (Math.PI * 2) / CATEGORY_ORDER.length;

              function pointAt(idx, r) {
                const angle = -Math.PI / 2 + idx * angleStep;
                const x = center + r * Math.cos(angle);
                const y = center + r * Math.sin(angle);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }

              const gridLevels = [0.25, 0.5, 0.75, 1];
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
                    <defs>
                      <radialGradient id="radarGlow" cx="50%" cy="50%" r="60%">
                        <stop offset="0%" stopColor="rgba(31, 95, 191, 0.18)" />
                        <stop offset="70%" stopColor="rgba(31, 95, 191, 0.06)" />
                        <stop offset="100%" stopColor="rgba(31, 95, 191, 0)" />
                      </radialGradient>
                      <linearGradient id="radarFill" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="rgba(41, 120, 255, 0.28)" />
                        <stop offset="100%" stopColor="rgba(13, 71, 161, 0.15)" />
                      </linearGradient>
                      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="rgba(17, 45, 90, 0.2)" />
                      </filter>
                    </defs>
                    <circle cx={center} cy={center} r={radius * 1.05} fill="url(#radarGlow)" />
                    {gridLevels.map((lv) => (
                      <polygon
                        key={lv}
                        points={CATEGORY_ORDER.map((_, i) => pointAt(i, radius * lv)).join(" ")}
                        fill="none"
                        stroke="#e1e7f2"
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
                        stroke="#dde6f5"
                        strokeWidth="1"
                      />
                    ))}
                    <polygon points={outlinePoints} fill="none" stroke="#c6d3ea" strokeWidth="1.5" />
                    <polygon
                      points={valuePoints}
                      fill="url(#radarFill)"
                      stroke="rgba(31, 95, 191, 0.7)"
                      strokeWidth="2"
                      filter="url(#softShadow)"
                    />
                    {CATEGORY_ORDER.map((t, i) => {
                      const pt = pointAt(i, (values[i] / maxValue) * radius).split(",");
                      return (
                        <circle
                          key={`dot-${t}`}
                          cx={pt[0]}
                          cy={pt[1]}
                          r="3.2"
                          fill="#1f5fbf"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      );
                    })}
                    {CATEGORY_ORDER.map((t, i) => {
                      const angle = -Math.PI / 2 + i * angleStep;
                      const labelRadius = radius + 22;
                      const x = center + labelRadius * Math.cos(angle);
                      const y = center + labelRadius * Math.sin(angle);
                      return (
                        <text
                          key={`label-${t}`}
                          x={x}
                          y={y}
                          fontSize="11.5"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#1f2f4a"
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
