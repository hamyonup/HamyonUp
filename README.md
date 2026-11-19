# HamyonUp — Android ilova 2.0.0

Ilova to'liq oflayn ishlaydi: hamma ma'lumot telefonning o'zida saqlanadi, server yoki hosting kerak emas.
Veb kod (React + Vite) Capacitor yordamida haqiqiy Android ilovaga (APK) o'raladi.

## APK olishning 2 yo'li

### 1-yo'l: GitHub orqali (kompyuterga hech narsa o'rnatmasdan)

1. github.com'da bepul akkaunt oching va yangi repozitoriya yarating.
2. Shu papkadagi **hamma fayllarni** (yashirin `.github` papkasi bilan) repozitoriyaga yuklang.
3. Repozitoriyada **Actions** bo'limiga kiring → **Android APK yig'ish** → **Run workflow**.
4. 5–10 daqiqadan keyin ish tugaydi. Ichiga kirib, pastdagi **Artifacts** ostidan `HamyonUp-APK` ni yuklab oling.
5. ZIP ichidagi `app-debug.apk` ni telefonga o'tkazing va o'rnating (Sozlamalar → "Noma'lum manbalardan o'rnatish"ga ruxsat bering).

### 2-yo'l: Kompyuterda

Kerak: Node.js 22, JDK 21, Android Studio (Android SDK bilan).

```bash
npm install
npm run android:init     # birinchi marta: android/ papkasini yaratadi, ikonka va splash qo'yadi
npm run android:apk      # APK yig'adi
```

APK shu yerda bo'ladi: `android/app/build/outputs/apk/debug/app-debug.apk`

Android Studio'da ochish uchun: `npm run android:open`.

Kodni o'zgartirgandan keyin: `npm run android:apk` yetarli. Ilova logotipi `public/wallet-logo.png` da saqlangan; `design-src/icon.svg`, `design-src/icon-foreground.svg` va `design-src/splash.svg` ichida ham ayni rasm Android ikonka va splash uchun ishlatiladi. Logotipni almashtirgandan keyin Android ikonkasini yangilang:

```bash
pnpm exec capacitor-assets generate --assetPath design-src --android --iconBackgroundColor '#1F6A35' --splashBackgroundColor '#1F6A35'
pnpm run android:apk
```

## Muhim

- Ma'lumotlar (balans, xarajatlar, maqsadlar, o'yin tangalari) telefon ichida saqlanadi. Ilovani o'chirib tashlasangiz, ma'lumotlar ham o'chadi.
- Bildirishnomalar yoqilganda Android ruxsati so'raladi; yordamchi har kuni 09:00, 14:00 va 19:00 da qurilma eslatmalarini rejalashtiradi. Android batareya tejash qoidalari yetkazish vaqtini biroz kechiktirishi mumkin.
- O'yinlarda Snake, Memory va Math Quiz mavjud; shashka hamda shaxmat hozircha tez kunda holatida.
- Supabase ulanmagan bo'lsa, reyting faqat shu telefondagi foydalanuvchilarni ko'rsatadi.
- Umumiy reyting uchun `supabase/leaderboard.sql` ni Supabase SQL Editor'da ishga tushiring, `.env.example` ni `.env` ga ko'chirib loyiha URL va publishable/anon key qiymatlarini kiriting, so'ng APK'ni qayta yig'ing. Balans va xarajatlar telefonda qoladi; reytingga profil nomi va tangalar yuboriladi.
- Umumiy reytingning SQL siyosatlari ID, ism va tanga qiymatlarini chegaralaydi. Guest ID bo'lgani uchun mijoz tomondan yuboriladigan natijani to'liq ishonchli deb bo'lmaydi; ommaviy reytingdagi soxta natijalarni ishonchli to'xtatish uchun autentifikatsiya va serverda ball hisoblash talab qilinadi.
- Google Play'ga joylash uchun `assembleDebug` o'rniga imzolangan `bundleRelease` kerak bo'ladi (alohida keystore bilan).
- Telefonning "Orqaga" tugmasi: boshqa bo'limda bo'lsangiz Asosiy bo'limga qaytaradi, Asosiyda bo'lsa ilovadan chiqadi.
- Android ilova versiyasi `android/app/build.gradle` ichida boshqariladi.
