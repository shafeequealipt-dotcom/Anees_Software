"use server";

import { cookies } from "next/headers";

export async function setLanguageAction(lang: "en" | "ar") {
  (await cookies()).set("lang", lang === "ar" ? "ar" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false });
}
