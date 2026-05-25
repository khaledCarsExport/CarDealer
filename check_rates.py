"""
check_rates.py
--------------
يُشغَّل تلقائياً عبر GitHub Actions كل 10 دقائق.
المهمة:
  1. يسأل API الجمارك الجزائرية عن أسعار EUR و USD
  2. يقارنها بالأسعار المحفوظة في last_rates.json
  3. إذا تغيّر أي سعر → يحدّث قاعدة البيانات khaled_cars.db ويرفعها
  4. يحفظ الأسعار الجديدة في last_rates.json
"""

import os
import json
import base64
import sqlite3
import requests
import urllib3
from datetime import datetime

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─────────────────────────────────────────────
# إعدادات — القيم تأتي من GitHub Secrets
# ─────────────────────────────────────────────
GITHUB_TOKEN     = os.environ["GH_TOKEN"]       # Secret اسمه GH_TOKEN
REPO_OWNER       = os.environ["REPO_OWNER"]     # مثال: khaledcarsexport
REPO_NAME        = os.environ["REPO_NAME"]      # مثال: CarDealer
DB_FILE_PATH     = os.environ.get("DB_FILE_PATH", "khaled_cars.db")
RATES_FILE_PATH  = os.environ.get("RATES_FILE_PATH", "last_rates.json")

API_URL = (
    "https://alces.douane.gov.dz/api/public/com/main/selectFxrtList"
    "?searchCondition=&searchKeyword=&searchKeywordFrom=&searchKeywordTo="
    "&langCd=&pageIndex=0&pageUnit=10&pageSize=10&firstIndex=0&lastIndex=0"
    "&recordCountPerPage=10&totCnt=0&rnum=0&aplyBgnDtFrom=&aplyBgnDtTo="
    "&aplyBgnDt=&aplyEndDt=&aplyDt=&xtrnOfrYn=&xtrnOfrDttm=&xtrnOfrEmpId="
    "&currNm=&currCd=&fxrt=0&aprvId=&delYn=&frstRegstId=&frstRgsrDttm="
    "&lastChprId=&lastChgDttm=&locale=fr-FR&fxrtTpCd=&buyAmt=0&selAmt=0"
)

TAX_RATE            = 0.4042
FIXED_COST          = 2500
BASE_ADJUSTMENT_EUR = 600
BASE_ADJUSTMENT_USD = 1700

GITHUB_API = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents"
HEADERS = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json"
}

# ─────────────────────────────────────────────
# دوال مساعدة GitHub
# ─────────────────────────────────────────────

def github_get_file(path):
    """جلب ملف من GitHub — يُرجع (content_bytes, sha) أو (None, None)"""
    r = requests.get(f"{GITHUB_API}/{path}", headers=HEADERS)
    if r.status_code == 200:
        data = r.json()
        content = base64.b64decode(data["content"])
        return content, data["sha"]
    return None, None


def github_put_file(path, content_bytes, sha, message):
    """رفع/تحديث ملف على GitHub"""
    data = {
        "message": message,
        "content": base64.b64encode(content_bytes).decode("utf-8"),
    }
    if sha:
        data["sha"] = sha
    r = requests.put(f"{GITHUB_API}/{path}", headers=HEADERS, json=data)
    return r.status_code in [200, 201]


# ─────────────────────────────────────────────
# جلب الأسعار من API الجمارك
# ─────────────────────────────────────────────

def fetch_new_rates():
    """يُرجع dict مثل {'EUR': 145.23, 'USD': 134.10} أو {} عند الفشل"""
    try:
        r = requests.get(API_URL, headers={"User-Agent": "Mozilla/5.0"},
                         verify=False, timeout=15)
        if r.status_code != 200:
            print(f"[ERROR] API returned HTTP {r.status_code}")
            return {}
        rates = {}
        for item in r.json().get("resultList", []):
            if item.get("currCd") in ["EUR", "USD"]:
                rates[item["currCd"]] = float(item.get("selAmt", 0))
        return rates
    except Exception as e:
        print(f"[ERROR] fetch_new_rates: {e}")
        return {}


# ─────────────────────────────────────────────
# جلب الأسعار المحفوظة من last_rates.json
# ─────────────────────────────────────────────

def get_saved_rates():
    """يُرجع dict الأسعار المحفوظة مسبقاً، أو {} إذا لم يوجد الملف"""
    content, _ = github_get_file(RATES_FILE_PATH)
    if content:
        try:
            return json.loads(content.decode("utf-8"))
        except Exception:
            pass
    return {}


def save_rates(rates):
    """يحفظ الأسعار الجديدة في last_rates.json على GitHub"""
    _, sha = github_get_file(RATES_FILE_PATH)
    content = json.dumps(rates, indent=2, ensure_ascii=False).encode("utf-8")
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    ok = github_put_file(RATES_FILE_PATH, content, sha,
                         f"Update last_rates.json - {now}")
    if ok:
        print(f"[OK] last_rates.json saved: {rates}")
    else:
        print("[ERROR] Failed to save last_rates.json")


# ─────────────────────────────────────────────
# تحديث قاعدة البيانات
# ─────────────────────────────────────────────

def update_database(db_bytes, new_rates):
    """
    يأخذ محتوى DB كـ bytes، يحدّث الأسعار والضرائب، يُرجع DB محدَّث كـ bytes
    """
    # حفظ DB مؤقتاً في ذاكرة GitHub Actions
    tmp_path = "/tmp/khaled_cars.db"
    with open(tmp_path, "wb") as f:
        f.write(db_bytes)

    count = 0
    try:
        conn = sqlite3.connect(tmp_path)
        cur  = conn.cursor()
        cur.execute("SELECT id, devise, Prix_neuf, Prix_1, Prix_2, Prix_3 FROM cars")
        rows = cur.fetchall()

        for car_id, devise, p_neuf, p_1, p_2, p_3 in rows:
            if devise == "EUR" and "EUR" in new_rates:
                new_taux = new_rates["EUR"]
                base_adj = BASE_ADJUSTMENT_EUR
            elif devise == "USD" and "USD" in new_rates:
                new_taux = new_rates["USD"]
                base_adj = BASE_ADJUSTMENT_USD
            else:
                continue

            p_neuf = float(p_neuf) if p_neuf else 0
            p_1    = float(p_1)    if p_1    else p_neuf
            p_2    = float(p_2)    if p_2    else p_1
            p_3    = float(p_3)    if p_3    else p_2

            neuf = (p_neuf + base_adj) * TAX_RATE * new_taux
            an_1 = ((p_1 + base_adj) * TAX_RATE * new_taux) / 2 + FIXED_COST
            an_2 = ((p_2 + base_adj) * TAX_RATE * new_taux) / 2 + FIXED_COST
            an_3 = ((p_3 + base_adj) * TAX_RATE * new_taux) / 2 + FIXED_COST

            cur.execute(
                "UPDATE cars SET taux_dc=?, neuf=?, an_1=?, an_2=?, an_3=? WHERE id=?",
                (new_taux, neuf, an_1, an_2, an_3, car_id)
            )
            count += 1

        conn.commit()
        conn.close()
        print(f"[OK] Updated {count} cars in database")

    except Exception as e:
        print(f"[ERROR] update_database: {e}")
        return db_bytes  # أرجع النسخة الأصلية عند الفشل

    with open(tmp_path, "rb") as f:
        return f.read()


# ─────────────────────────────────────────────
# البرنامج الرئيسي
# ─────────────────────────────────────────────

def main():
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n{'='*50}")
    print(f"[START] Rate check at {now}")
    print(f"{'='*50}")

    # 1. جلب الأسعار الجديدة من API
    new_rates = fetch_new_rates()
    if not new_rates:
        print("[SKIP] Could not fetch rates from API")
        return

    print(f"[API] Fetched rates: {new_rates}")

    # 2. مقارنة مع الأسعار المحفوظة
    saved_rates = get_saved_rates()
    print(f"[SAVED] Last known rates: {saved_rates}")

    eur_changed = new_rates.get("EUR") != saved_rates.get("EUR")
    usd_changed = new_rates.get("USD") != saved_rates.get("USD")

    if not eur_changed and not usd_changed:
        print("[NO CHANGE] Rates unchanged — nothing to do")
        return

    # 3. طباعة التغييرات
    if eur_changed:
        print(f"[CHANGE] EUR: {saved_rates.get('EUR')} → {new_rates.get('EUR')}")
    if usd_changed:
        print(f"[CHANGE] USD: {saved_rates.get('USD')} → {new_rates.get('USD')}")

    # 4. جلب قاعدة البيانات من GitHub
    db_bytes, db_sha = github_get_file(DB_FILE_PATH)
    if db_bytes is None:
        print(f"[ERROR] Could not fetch {DB_FILE_PATH} from GitHub")
        return

    # 5. تحديث قاعدة البيانات
    updated_db = update_database(db_bytes, new_rates)

    # 6. رفع قاعدة البيانات المحدَّثة
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    msg = f"Auto rate update: EUR={new_rates.get('EUR')} USD={new_rates.get('USD')} - {now_str}"
    ok = github_put_file(DB_FILE_PATH, updated_db, db_sha, msg)

    if ok:
        print(f"[OK] Database uploaded to GitHub")
    else:
        print(f"[ERROR] Failed to upload database")
        return

    # 7. حفظ الأسعار الجديدة
    save_rates(new_rates)
    print(f"[DONE] Update complete at {now_str}")


if __name__ == "__main__":
    main()
