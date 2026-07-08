# 경로 B 배포 체크리스트 — 멀티유저 전환 (Firebase Auth + 초대 코드)

> 이 문서는 `docs/COMMERCIALIZATION.md` §4.B 구현(브랜치
> `claude/daniel-tracker-commercialization-uj2nxs`)을 실서비스에 반영하는 순서다.
> **코드 머지만으로는 동작하지 않는다** — Firebase 콘솔 작업이 함께 필요하다.

---

## 0. 이번 전환의 요약

| 항목 | 이전 (1인용) | 이후 (경로 B) |
|---|---|---|
| 로그인 | 프로필 선택 + 선택적 비밀번호 | **Google 로그인** (Firebase Auth) |
| 가입 제한 | 없음 (누구나 프로필 생성) | **초대 코드** (`invites/{code}`, 규칙이 검증) |
| Firestore 규칙 | App Check만 (누구나 타인 데이터 접근 가능) | App Check + **본인(auth.uid)** + **멤버** |
| 공용 음식/운동 DB | 전원 읽기/쓰기 | 멤버 읽기 전용, **쓰기는 운영자만** |
| 프로필 | `_shared/profiles` 목록 (비번 해시 포함) | `users/{uid}/data/profile` (온보딩 입력) |
| 푸시 API | uid 무검증 (사칭 가능) | **Firebase ID 토큰 검증** |
| 앱 이름 | Daniel Body Plan / Daniel Tracker | **Body Plan** |
| verify-master API | 프로필 삭제용 마스터키 | 제거 (Auth가 대체) |

운영자(owner) = `munansa@gmail.com` — 두 곳에 하드코딩되어 있으며 반드시 같아야 함:
`src/auth.js`의 `OWNER_EMAIL`(빌드 시 `VITE_OWNER_EMAIL`로 교체 가능), `firestore.rules`의 `isOwner()`.

---

## 1. Firebase 콘솔 — 머지 전에 미리 해둘 것

1. **Authentication → 로그인 방법 → Google 사용 설정** (프로젝트 지원 이메일 지정)
2. **Authentication → 설정 → 승인된 도메인**에 다음이 있는지 확인:
   - `daniel-tracker.vercel.app` (프로덕션)
   - `localhost` (개발)
   - Vercel 프리뷰 도메인은 필요할 때만 추가 (`*-<team>.vercel.app`은 와일드카드 불가 — 개별 추가)
3. **Firestore → invites 컬렉션에 초대 코드 문서 생성** (지인 수만큼):
   - 문서 ID = 코드 문자열 (추측 불가능하게, 예: `BP-7K2M-XQ9F`)
   - 필드: `active` (boolean) = `true`, `note` (string) = "누구용" 메모
   - 폐기할 때는 `active: false`로 수정 (삭제해도 됨 — 이미 가입한 멤버는 영향 없음)

## 1.5 프리뷰(머지 전) 테스트 — 전환기 규칙

머지 결정 전에 Vercel Preview에서 실동작을 확인하려면 규칙 문제를 먼저 풀어야 한다:
현재 게시된 규칙은 `members`/`invites` 경로를 전부 차단해 **새 앱이 멤버 등록에서 막히고**,
반대로 최종 규칙(`firestore.rules`)을 게시하면 **기존 앱(폰)의 동기화가 멈춘다**.

→ 아래 **전환기 규칙**을 게시하면 둘 다 동작한다 (개인 데이터 보호 수준은 기존과 동일한
App Check 단계 — 전환기 한정. 머지 후 §3에서 최종 규칙으로 교체):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.app != null && request.auth != null; }
    function isSelf(uid) { return signedIn() && request.auth.uid == uid; }
    function isOwner() {
      return signedIn()
        && request.auth.token.email == 'munansa@gmail.com'
        && request.auth.token.email_verified == true;
    }

    // 새 앱(프리뷰)용 — 최종 규칙과 동일
    match /invites/{code} { allow read, write: if false; }
    match /members/{uid} {
      allow get: if isSelf(uid);
      allow create: if isSelf(uid)
        && request.resource.data.keys().hasOnly(['code', 'email', 'joinedAt'])
        && request.resource.data.email == request.auth.token.email
        && (isOwner()
            || (request.resource.data.code is string
                && get(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.active == true));
      allow list, update, delete: if false;
    }

    // 전환기: 기존 앱 호환 (현행과 동일한 App Check 단계 보호)
    match /users/{uid}/data/{document=**} {
      allow read, write: if request.app != null;
    }
    match /users/_shared/data/{doc} {
      allow read, write: if request.app != null;
    }

    match /{document=**} { allow read, write: if false; }
  }
}
```

프리뷰 테스트 전 콘솔 준비 (§1과 겹치는 것 포함, 순서대로):
1. Google 제공업체 켜기 (§1-1)
2. **Vercel Preview 도메인**을 두 곳에 등록 — PR의 Vercel 봇 코멘트에서 프리뷰 URL 확인 후:
   - Firebase Authentication → 승인된 도메인
   - reCAPTCHA v3 키 설정 → 도메인 (App Check용 — 누락 시 request.app이 null이 되어 전부 거부됨.
     테스트 동안만 `vercel.app` 상위 도메인을 넣으면 모든 프리뷰가 커버되고, 끝나면 제거)
3. 위 전환기 규칙 게시
4. 초대 코드 문서 1개 생성 (§1-3) — 초대 흐름 테스트용
5. (선택) 프리뷰에서 AI 분석·푸시는 서버 origin 화이트리스트(PRODUCTION_ORIGIN·VERCEL_URL)
   때문에 막힐 수 있음 — 프리뷰 검증 대상은 로그인 → 초대 → 온보딩 → 가져오기 → 기록 흐름

프리뷰 테스트 시나리오 (운영자 계정):
- Google 로그인 → 초대 코드 없이 자동 가입되는지
- 온보딩에서 **175 / 42 / 15** 입력 → 홈 진입
- ⋮ 메뉴 → 기존 데이터 가져오기(`daniel`) → 새로고침 후 기록·체성분·달력 dot·**홈 목표 K(체중 77.3 기준 1570)** 확인
- 다른 Google 계정으로도 로그인해 초대 코드 흐름(잘못된 코드 거부 → 올바른 코드 통과 → 온보딩) 확인
- ⚠️ 프리뷰 단계의 가져오기는 **실데이터가 아니라 사본**에 쓰는 게 아니라 실제 새 계정
  경로(`users/{auth-uid}`)에 쓴다 — 원본(`users/daniel`)은 읽기만 하므로 안전하고,
  테스트로 생긴 새 계정 데이터는 본 전환 때 병합돼도 무해(멱등)

## 2. 전환 직전 — 데이터 안전

4. **기존 앱(폰)을 온라인 상태로 한 번 열어** 오프라인 대기분(syncQueue)을 Firestore에 반영
   (새 규칙이 게시되면 구버전 앱은 동기화가 중단되므로, 게시 전에 밀어올려야 함)
5. 설정 → **JSON 전체 백업** 1회 (만일의 사고 대비)

## 3. 규칙 게시 + 코드 배포 (같은 타이밍에)

6. **Firestore → 규칙**에 저장소의 `firestore.rules` 내용 붙여넣고 게시
7. main 머지 → Vercel 자동 배포 (규칙 게시와 배포 사이엔 구버전 앱 동기화가 잠시 멈춤 —
   localStorage 폴백으로 화면은 정상, 이후 새 앱에서 마이그레이션으로 승계됨)

## 4. Daniel 계정 전환 (1회)

8. 새 앱에서 **Google로 로그인** (`munansa@gmail.com`) — 운영자는 초대 코드 없이 자동 가입
9. 온보딩에서 프로필 입력 — **키 175 / 나이 42 / 목표 체지방 15** (calcTargets 입력값.
   구 구조에선 키·나이가 `_shared/profiles`에만 있어 마이그레이션이 복원 못 함 —
   여기서 잘못 넣으면 목표 K가 달라지고 반올림 경계의 과거 판정까지 흔들림)
10. 헤더 ⋮ 메뉴 → **기존 데이터 가져오기** → 이전 프로필 ID(기본 `daniel`) → 가져오기
    - Firestore 문서 + 진행 사진 + (같은 기기라면) 미동기화 로컬 값까지 **병합** 복사됨
      (새 계정에 이미 만든 기록은 지워지지 않고 합쳐짐 · 설정(goals)은 가져온 값 우선)
    - 완료 후 자동 새로고침 → **홈 목표 K가 기존과 동일한지(예: 체중 77.3 기준 1570)** 확인
11. **푸시 재설정 (레거시 구독 정리 — 유령 알림 방지)**:
    구 uid(`daniel`)의 구독이 KV에 남아 있으면 상태가 동결된 채 매일 밤 "기록 안 했어요"
    오탐 푸시가 계속 온다(같은 기기·같은 엔드포인트라 404 자체 정리도 발동 안 함).
    - 방법 A(권장): 마이그레이션 후 설정 → 알림 → **"알림 끄기(구독 해제)" → 다시 켜기**
      (엔드포인트가 회전돼 다음 크론에서 레거시 구독이 410으로 자동 정리됨)
    - 방법 B: Upstash 콘솔에서 `DEL push:sub:daniel push:state:daniel` +
      `SREM push:uids daniel`
12. 확인 후 콘솔에서 정리(선택이지만 권장):
    - `users/_shared/data/profiles` 문서 **삭제** (구 비밀번호 해시 포함 — Auth가 대체)
    - 레거시 `users/daniel` 데이터는 검증 후 삭제 가능 (백업 확인 후)
    - `firestore.rules`의 운영자 read 라인(`allow read: if isOwner()`)은 마이그레이션용 —
      제거해도 되고, 관리 목적으로 유지해도 됨(콘솔 접근 권한과 동일 수준)

## 5. Vercel 환경변수

13. `VAPID_SUBJECT` = `mailto:<서비스 주소>` 로 교체 (현재 코드 폴백은 개인 이메일)
14. `ADMIN_MASTER_KEY` 삭제 (verify-master API 제거됨)
15. (선택) `FIREBASE_WEB_API_KEY` — push-sync의 ID 토큰 검증용. 미설정 시 코드의 공개 웹 키 사용
16. (선택) `VITE_OWNER_EMAIL` — 운영자 이메일을 빌드에서 바꿀 때. **firestore.rules도 함께 수정**

## 6. 지인 초대 흐름 (참고)

- 초대 코드 전달 → 지인이 `https://daniel-tracker.vercel.app` 접속 → Google 로그인 →
  초대 코드 입력 → 프로필(이름·키·나이·목표 체지방) 입력 → 사용 시작
- 지인의 AI 분석/직접 추가 음식·운동은 **개인 DB에만** 저장됨 (공용 DB는 읽기 전용)
- 알림(웹푸시)·주간 성적표·JSON 백업/복원은 계정별로 동일하게 동작
- 로그아웃하면 그 기기의 푸시 구독은 자동 해제됨 (공용 기기에서 이전 사용자 알림 방지 —
  다시 로그인하면 설정에서 알림을 다시 켜야 함)

## 7. 알려진 제약 (경로 B 범위 밖)

- **Vercel Hobby 약관**: 무료 공유는 회색지대, **유료화(경로 C) 시 Pro 필수** — §4.C-4
- Firebase Spark 무료 한도(읽기 5만/일): 소수 인원은 충분, 수십 명부터 모니터링 필요
- iOS PWA에서 Google 팝업 로그인이 막히면 자동으로 리다이렉트 방식 폴백 —
  그래도 문제 시 Safari에서 로그인 후 홈 화면 추가 안내
- 계정 삭제·개인정보처리방침 등 법적 요건은 **유료화 전 필수** — §4.C-3·5
