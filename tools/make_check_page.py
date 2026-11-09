"""出題される生徒の姿と名前を確認するための一覧ページ tools/check.html を作る。

使い方: py tools/make_check_page.py
- 実装済みの生徒の画像は SchaleDB、NPC の画像は wikiru の NPC一覧から直接読み込む
- 生成物（check.html）はリポジトリには含めない
"""
import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "students.js"
OUT = ROOT / "tools" / "check.html"
WIKIRU = "https://bluearchive.wikiru.jp/"
NPC_LIST = WIKIRU + "?NPC%E4%B8%80%E8%A6%A7"


def load_data():
    text = DATA.read_text(encoding="utf-8")
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


def wikiru_icons():
    """wikiru の NPC一覧から 名前 → アイコン URL を作る。"""
    req = urllib.request.Request(NPC_LIST, headers={"User-Agent": "Mozilla/5.0"})
    page = urllib.request.urlopen(req).read().decode("utf-8")
    icons = {}
    pattern = r'NPC<br class="spacer" /><a href="\./\?[^"]+" title="([^"]+)"[^>]*>.{0,400}?data-src="([^"]+)"'
    for title, src in re.findall(pattern, page, re.S):
        icons.setdefault(html.unescape(title), WIKIRU + src)
    return icons


def card(p, icons):
    if p["npc"]:
        img = icons.get(p["name"], "")
    else:
        img = f"https://schaledb.com/images/student/icon/{p['id']}.webp"
    esc = html.escape
    if p["family"]:
        reading = esc(p["familyRuby"]) if p["familyRuby"] else "読み不明"
        full = f"{esc(p['family'])}{esc(p['name'])}<div class=\"reading\">{reading}</div>"
    else:
        full = f"{esc(p['name'])}<span class=\"nofam\">（名字なし）</span>"
    answers = " / ".join(esc(a) for a in p["answers"] + p["fullAnswers"])
    img_tag = f'<img src="{esc(img)}" loading="lazy" alt="">' if img else '<div class="noimg">画像なし</div>'
    badge = '<span class="npc">NPC</span>' if p["npc"] else ""
    return (f'<div class="card{" is-npc" if p["npc"] else ""}">{badge}{img_tag}'
            f'<div class="full">{full}</div><div class="club">{esc(p["club"])}</div>'
            f'<div class="ans">{answers}</div></div>')


def main():
    data = load_data()
    icons = wikiru_icons()
    students = data["students"]
    sections = []
    for s in data["schools"]:
        members = [p for p in students if p["school"] == s["key"]]
        if not members:
            continue
        npc = sum(p["npc"] for p in members)
        cards = "".join(card(p, icons) for p in members)
        sections.append(f'<section><h2>{html.escape(s["long"])} <small>{len(members)}人'
                        f'（NPC {npc}人）</small></h2><div class="grid">{cards}</div></section>')
    total_npc = sum(p["npc"] for p in students)
    missing = [p["name"] for p in students if p["npc"] and p["name"] not in icons]
    note = f'<p class="warn">wikiru で画像が見つからなかった NPC: {html.escape("、".join(missing))}</p>' if missing else ""
    OUT.write_text(f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>出題生徒の確認一覧</title>
<style>
body {{ margin: 0; padding: 16px; background: #f4f7fb; color: #1d2b45; font-family: "Meiryo", sans-serif; }}
h1 {{ font-size: 22px; margin: 0 0 4px; }}
.lead {{ color: #5b6b86; margin: 0 0 12px; font-size: 13px; }}
.filter {{ position: sticky; top: 0; background: #f4f7fb; padding: 8px 0; z-index: 1; font-size: 14px; }}
h2 {{ font-size: 17px; border-left: 5px solid #128afa; padding-left: 8px; margin: 22px 0 8px; }}
h2 small {{ color: #5b6b86; font-weight: normal; font-size: 13px; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }}
.card {{ position: relative; background: #fff; border: 1px solid #d4e3f5; border-radius: 8px; padding: 8px; text-align: center; }}
.card.is-npc {{ border-color: #e2a0ab; background: #fff8f9; }}
.card img, .noimg {{ width: 96px; height: 96px; object-fit: cover; border-radius: 8px; background: #e8eef6; }}
.noimg {{ display: inline-flex; align-items: center; justify-content: center; color: #e2445c; font-size: 12px; }}
.full {{ font-size: 16px; font-weight: bold; margin-top: 4px; }}
.reading {{ font-size: 11px; color: #5b6b86; font-weight: normal; }}
.nofam {{ font-size: 11px; color: #5b6b86; font-weight: normal; }}
.club {{ font-size: 12px; color: #5b6b86; }}
.ans {{ font-size: 11px; color: #8a97ad; margin-top: 4px; word-break: break-all; }}
.npc {{ position: absolute; top: 6px; right: 6px; background: #e2445c; color: #fff; font-size: 10px; font-weight: bold; padding: 1px 5px; border-radius: 3px; }}
.warn {{ color: #e2445c; font-weight: bold; }}
.npc-only .card:not(.is-npc) {{ display: none; }}
</style></head><body>
<h1>出題生徒の確認一覧</h1>
<p class="lead">全 {len(students)} 人（実装済み {len(students) - total_npc} 人 / NPC {total_npc} 人）。
画像: 実装済み = SchaleDB、NPC = wikiru NPC一覧。灰色の小さい文字は正解として受け付ける入力（ひらがな化したもの）。</p>
{note}
<div class="filter"><label><input type="checkbox" id="npcOnly"> NPC だけ表示</label></div>
<div id="list">{"".join(sections)}</div>
<script>
document.getElementById("npcOnly").addEventListener("change", (e) =>
  document.getElementById("list").classList.toggle("npc-only", e.target.checked));
</script>
</body></html>
""", encoding="utf-8")
    print(f"{len(students)} 人 -> {OUT}")
    if missing:
        print("画像なし:", "、".join(missing))


if __name__ == "__main__":
    main()
