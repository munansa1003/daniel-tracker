# Daniel Tracker — 식단·운동·체성분 관리 웹앱

스마트폰 홈 화면에서 앱처럼 사용할 수 있는 PWA(Progressive Web App)입니다.
오프라인에서도 작동하며, 데이터는 브라우저의 localStorage에 저장됩니다.

---

## 🚀 실행 방법 (3가지)

---

### 방법 1. PC에서 로컬 실행 (개발/테스트용)

**필요한 것**: Node.js 18 이상 ([다운로드](https://nodejs.org))

```bash
# 1. 압축 풀기
unzip daniel-tracker.zip
cd daniel-tracker

# 2. 패키지 설치
npm install

# 3. 개발 서버 실행
npm run dev
```

터미널에 `http://localhost:5173` 주소가 나오면 브라우저에서 열면 됩니다.
같은 Wi-Fi의 스마트폰에서도 `http://PC의IP주소:5173`으로 접속 가능합니다.

---

### 방법 2. Vercel에 무료 배포 (★ 가장 추천 — 스마트폰 전용 URL 생성)

**필요한 것**: GitHub 계정 + Vercel 계정 (둘 다 무료)

#### 단계별 안내

**① GitHub에 코드 올리기**

```bash
# Git 초기화
cd daniel-tracker
git init
git add .
git commit -m "initial commit"

# GitHub에서 새 저장소(repository) 만들기
# https://github.com/new 에서 "daniel-tracker" 이름으로 생성

# 연결 후 푸시
git remote add origin https://github.com/내아이디/daniel-tracker.git
git branch -M main
git push -u origin main
```

**② Vercel에서 배포하기**

1. https://vercel.com 접속 → "Sign Up" → GitHub 계정으로 로그인
2. "Add New..." → "Project" 클릭
3. "Import Git Repository"에서 `daniel-tracker` 선택
4. "Deploy" 클릭 (설정 변경 없이 그대로)
5. 1~2분 후 배포 완료!

배포되면 `https://daniel-tracker-xxxx.vercel.app` 같은 URL이 생깁니다.

**③ 스마트폰 홈 화면에 추가**

- **iPhone**: Safari에서 URL 접속 → 공유 버튼(□↑) → "홈 화면에 추가"
- **Android**: Chrome에서 URL 접속 → 점 세 개 메뉴(⋮) → "홈 화면에 추가"

이제 앱처럼 아이콘 터치하면 바로 열립니다!

---

### 방법 3. Netlify에 드래그 앤 드롭 배포 (Git 없이 가능!)

**필요한 것**: Node.js만 설치되어 있으면 됨

```bash
# 1. 빌드
cd daniel-tracker
npm install
npm run build

# 2. dist 폴더가 생성됨
```

3. https://app.netlify.com/drop 접속
4. `dist` 폴더를 브라우저 화면에 드래그 앤 드롭
5. 즉시 배포 완료! URL이 생성됩니다.

---

## 📱 스마트폰에서 사용하기

배포 후 스마트폰에서:

1. 배포된 URL을 브라우저에서 엽니다
2. "홈 화면에 추가"를 합니다
3. 이제 일반 앱처럼 아이콘을 터치해서 사용합니다
4. 인터넷 연결이 없어도 작동합니다 (PWA)

---

## 📂 프로젝트 구조

```
daniel-tracker/
├── index.html          # HTML 진입점
├── package.json        # 의존성 관리
├── vite.config.js      # Vite + PWA 설정
├── public/
│   ├── icon-192.png    # PWA 아이콘 (작은)
│   ├── icon-512.png    # PWA 아이콘 (큰)
│   └── icon.svg        # 원본 아이콘
└── src/
    ├── main.jsx        # React 진입점
    ├── App.jsx         # 메인 앱 (전체 UI + 로직)
    ├── store.js        # localStorage 저장소
    └── data.js         # 음식/운동 DB + 목표값
```

---

## 🔧 커스텀하기

### 목표 수치 변경
`src/data.js` 파일에서:
```js
export const TARGETS = {
  p: 170,      // 단백질 목표 (g)
  c: 217,      // 탄수화물 목표 (g)
  f: 62,       // 지방 목표 (g)
  k: 2106,     // 칼로리 목표 (kcal)
  weight: 77.5 // 현재 체중 (운동 소모 칼로리 계산용)
};
```

### 음식/운동 DB 수정
같은 `src/data.js` 파일의 `DEFAULT_FOODS`와 `DEFAULT_EX` 배열을 수정하면 됩니다.
앱 안에서도 "DB 관리" 버튼으로 직접 추가/삭제가 가능합니다.

---

## 💾 데이터 관리

- 데이터는 브라우저의 **localStorage**에 저장됩니다
- 같은 브라우저에서 접속하면 데이터가 유지됩니다
- 브라우저 데이터를 삭제하면 데이터도 삭제됩니다
- **정기적으로 CSV 내보내기를 하세요!** (통계 탭 하단 버튼)
- 내보낸 CSV 파일은 엑셀에서 바로 열 수 있습니다

---

## ❓ 자주 묻는 질문

**Q: 다른 기기에서도 데이터가 동기화되나요?**
A: 현재는 같은 브라우저에서만 데이터가 유지됩니다. 기기 간 동기화가 필요하면 Firebase나 Supabase 같은 백엔드를 추가해야 합니다.

**Q: 데이터가 날아갈 수 있나요?**
A: 브라우저 캐시를 삭제하거나 시크릿 모드에서 사용하면 날아갈 수 있습니다. CSV 백업을 주기적으로 하세요.

**Q: 완전 무료인가요?**
A: 네. Vercel/Netlify 무료 플랜으로 충분합니다. 월 방문자 10만 이하는 무료입니다.
