# Firestore 규칙 필드 검증 — 배포 절차 (2026-08 감사 R-36)

**상태: 작성만 완료. 배포하지 않았음.**
제안본은 `firestore.rules.proposed`, 현재 운영 중인 것은 `firestore.rules`다.

---

## 1. 무엇이 바뀌나

개인 데이터 매치 한 줄이 두 줄로 갈라지고, 평면 문서에만 필드 화이트리스트가 붙는다.

### 현행 (`firestore.rules`)

```
match /users/{uid}/data/{document=**} {
  allow read, write: if isSelf(uid) && isMember();
  allow read: if isOwner();
}
```

### 제안 (`firestore.rules.proposed`)

```
match /users/{uid}/data/{key} {
  allow read: if (isSelf(uid) && isMember()) || isOwner();
  allow create, update: if isSelf(uid) && isMember()
    && request.resource.data.keys().hasOnly(['value', 'updatedAt']);
  allow delete: if isSelf(uid) && isMember();
}

match /users/{uid}/data/photos/items/{photoId} {
  allow read, write: if isSelf(uid) && isMember();
  allow read: if isOwner();
}
```

## 2. 왜

지금은 본인·멤버이기만 하면 개인 데이터 경로에 **어떤 키의 어떤 모양이든** 쓸 수 있다.
앱은 항상 `{ value, updatedAt }`만 쓰므로(`store.js:316`), 화이트리스트가 곧 실제 계약이다.
버그난 클라이언트나 탈취된 토큰이 임의 문서를 무제한 생성하는 것을 막는다.

**이건 방어 심화지 구멍 메우기가 아니다.** 지금도 남의 데이터에는 접근할 수 없다.
급하지 않으니 배포는 여유 있을 때 하면 된다.

## 3. ⚠️ 가장 위험한 지점 — 진행 사진

`{document=**}`(재귀)를 `{key}`(단일 세그먼트)로 바꾸는 순간,
**깊이 3인 `users/{uid}/data/photos/items/{id}`가 매치에서 빠진다.**

제안본에 ② 블록을 넣어 막아뒀지만, 규칙을 손으로 편집하다 이 줄을 지우면
**진행 사진 저장·조회·삭제가 전부 조용히 거부된다.** 증상이 "사진만 안 올라감"이라
원인이 규칙으로 이어지지 않는다. 아래 4-③ 테스트를 반드시 통과시킬 것.

부수 확인: `users/_shared/...`는 uid 자리가 `_shared`라 `isSelf`가 거짓 →
①이 아무 권한도 주지 않고 기존 `_shared` 규칙이 그대로 담당한다(공용 DB 영향 없음).

## 4. 배포 전 검증 — Firebase Console → Firestore → 규칙 → **Rules Playground**

제안본을 편집기에 붙여넣고 **게시하지 말고** Playground에서 아래 6가지를 돌린다.
하나라도 기대와 다르면 배포하지 않는다.

| # | 시뮬레이션 | 위치 | 인증 | 데이터 | 기대 |
|---|---|---|---|---|---|
| ① | get | `/users/<내uid>/data/goals` | 본인 uid | — | **허용** |
| ② | create | `/users/<내uid>/data/goals` | 본인 uid | `{value:{mode:"cut"}, updatedAt:"2026-08-09"}` | **허용** |
| ③ | create | `/users/<내uid>/data/photos/items/p1` | 본인 uid | `{url:"x", at:"2026-08-09"}` | **허용** ← 이게 거부되면 ② 블록이 빠진 것 |
| ④ | create | `/users/<내uid>/data/goals` | 본인 uid | `{value:1, evil:"x"}` | **거부** ← 이 변경의 목적 |
| ⑤ | delete | `/users/<내uid>/data/day:2026-01-01` | 본인 uid | — | **허용** ← 거부되면 복원 시 정리가 막힘 |
| ⑥ | get | `/users/<남의uid>/data/goals` | 본인 uid | — | **거부** |

> Playground는 App Check(`request.app`)를 만족시키지 못해 전부 거부로 나올 수 있다.
> 그 경우 `signedIn()`의 `request.app != null`을 잠시 지우고 테스트한 뒤 **반드시 되돌린다.**
> 되돌리는 것을 잊으면 외부 SDK·curl 차단이 사라진다.

## 5. 배포

이 저장소에는 `firebase.json`이 없어 CLI 배포가 설정돼 있지 않다. 두 가지 방법:

**A. 콘솔에 붙여넣기 (권장 — 되돌리기가 쉽다)**
1. Firebase Console → Firestore Database → **규칙** 탭
2. **현재 내용을 전부 복사해 로컬에 저장** (← 롤백용. 이 단계를 건너뛰지 말 것)
3. `firestore.rules.proposed` 내용으로 교체 → **게시**

**B. CLI**
```powershell
firebase init firestore     # firebase.json이 없으므로 최초 1회
Copy-Item firestore.rules.proposed firestore.rules -Force
firebase deploy --only firestore:rules
```

## 6. 배포 직후 확인 (5분 안에)

앱을 열고 **실제로** 다음을 해본다. 하나라도 실패하면 즉시 7번으로.

- [ ] 식사 1건 추가 → 새로고침 후에도 남아 있는가 (평면 문서 쓰기)
- [ ] 체성분 1건 추가/삭제 (배열 문서 쓰기 + 삭제)
- [ ] 설정에서 목표 변경 (goals 쓰기)
- [ ] **진행 사진 1장 업로드 → 목록에 보이는가** (깊이 3 경로 — 가장 위험)
- [ ] 다른 기기에서 열어 동기화되는가

## 7. 롤백

**A로 배포했다면**: 규칙 탭에서 5-②에 저장해둔 이전 내용을 붙여넣고 게시. 즉시 반영된다.

**B로 배포했다면**:
```powershell
git checkout firestore.rules      # 저장소의 현행본으로 되돌림
firebase deploy --only firestore:rules
```

규칙은 **즉시** 반영되고 데이터에는 영향이 없다 — 되돌리면 잃는 것이 없다.
반영까지 최대 1분 정도 걸릴 수 있으니, 되돌린 뒤 앱을 새로고침해서 확인한다.

## 8. 배포를 마쳤다면

`firestore.rules.proposed`의 내용을 `firestore.rules`로 옮기고 이 문서에
배포일을 적은 뒤, 제안본 파일과 이 절차 문서는 지워도 된다.
