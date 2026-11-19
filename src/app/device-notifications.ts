import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

type ReminderLanguage = "uz" | "en" | "ru";

const REMINDER_IDS = [8301, 8302, 8303];
const REMINDER_TIMES = [
  { hour: 9, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 19, minute: 0 },
];

const REMINDERS: Record<ReminderLanguage, Array<{ title: string; body: string }>> = {
  uz: [
    { title: "Hamyonchi yordamchi ✨", body: "Xayrli tong! Bugun maqsadingiz sari kichik bir qadam tashlang." },
    { title: "Hamyonchi yordamchi 💡", body: "Xarajatlaringizni yozib qo'ying — hisobingiz doim aniq bo'lsin." },
    { title: "Hamyonchi yordamchi 🌙", body: "Kuningizni sarhisob qiling va ertangi rejangizni belgilang." },
  ],
  en: [
    { title: "Wallet buddy ✨", body: "Good morning! Take one small step toward your goal today." },
    { title: "Wallet buddy 💡", body: "Log your spending to keep your balance up to date." },
    { title: "Wallet buddy 🌙", body: "Review your day and set a simple goal for tomorrow." },
  ],
  ru: [
    { title: "Помощник-кошелёк ✨", body: "Доброе утро! Сделайте сегодня небольшой шаг к своей цели." },
    { title: "Помощник-кошелёк 💡", body: "Запишите расходы, чтобы баланс оставался точным." },
    { title: "Помощник-кошелёк 🌙", body: "Подведите итоги дня и наметьте план на завтра." },
  ],
};

export async function cancelAssistantReminders() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) });
  } catch {
    // There may be no scheduled reminders yet.
  }
}

export async function scheduleAssistantReminders(language: ReminderLanguage, requestPermission: boolean) {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted" && requestPermission) {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== "granted") return false;

    await cancelAssistantReminders();
    const messages = REMINDERS[language] ?? REMINDERS.uz;
    await LocalNotifications.createChannel({
      id: "assistant-reminders",
      name: language === "en" ? "Wallet reminders" : language === "ru" ? "Напоминания помощника" : "Eslatmalar",
      description: language === "en" ? "Daily reminders from your wallet helper" : language === "ru" ? "Ежедневные напоминания от помощника" : "Hamyonchi yordamchidan kundalik eslatmalar",
      importance: 3,
      vibration: true,
    });
    await LocalNotifications.schedule({
      notifications: REMINDER_IDS.map((id, index) => ({
        id,
        title: messages[index].title,
        body: messages[index].body,
        schedule: { on: REMINDER_TIMES[index], allowWhileIdle: true },
        smallIcon: "ic_stat_wallet",
        iconColor: "#2D8C4E",
        channelId: "assistant-reminders",
        extra: { screen: "home", source: "assistant-reminder" },
      })),
    });
    return true;
  } catch {
    return false;
  }
}
