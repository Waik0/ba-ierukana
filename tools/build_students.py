"""SchaleDB の生徒データと data/npcs.json から data/students.js を生成する。

使い方: py tools/build_students.py
- 衣装違い（「アル（正月）」など）は同一人物としてまとめる
- コラボキャラは除外する
- data/npcs.json の未実装生徒（NPC）を npc: true で追加する（実装済みなら除外）
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://schaledb.com/data/jp/"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "students.js"
NPCS = ROOT / "data" / "npcs.json"

# 学校の表示順（NPC 専用の学校は npcs.json の "before" で差し込む）
SCHOOL_ORDER = [
    "Abydos", "Gehenna", "Trinity", "Millennium", "Hyakkiyako", "Shanhaijing",
    "RedWinter", "Valkyrie", "SRT", "Arius", "Highlander", "WildHunt", "Odyssey",
]
COLLAB = {"ETC", "Tokiwadai", "Sakugawa"}

# 同一人物としてまとめるもの
MERGE = {"シロコ＊テラー": "シロコ"}

# SchaleDB に名字がない生徒の名字（名前: (名字, 読み)）
FAMILY_OVERRIDE = {"ケイ": ("天童", "てんどう")}


def fetch(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "ba-ierukana-builder"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def to_hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def base_name(name):
    n = re.sub(r"[（(].*?[）)]", "", name).strip()
    return MERGE.get(n, n)


def make_answers(name, family, family_rubies, aliases=()):
    """名前だけの回答と、フルネームの回答をひらがな化して返す。"""
    answers = sorted({to_hira(a) for a in (name, *aliases)})
    full = []
    if family:
        full.append(to_hira(family + name))
        full += [to_hira(r + name) for r in family_rubies if r]
    return answers, sorted(set(full))


def main():
    students = fetch("students.min.json")
    loc = fetch("localization.min.json")
    clubs = loc["Club"]
    npc_data = json.loads(NPCS.read_text(encoding="utf-8"))

    people = {}
    for s in sorted(students.values(), key=lambda x: x["Id"]):
        if not s["IsReleased"][0] or s["School"] in COLLAB:
            continue
        name = base_name(s["Name"])
        if name in people:
            continue
        family, ruby = s["FamilyName"].strip(), s["FamilyNameRuby"].strip()
        if not family and name in FAMILY_OVERRIDE:
            family, ruby = FAMILY_OVERRIDE[name]
        answers, full = make_answers(name, family, [ruby])
        people[name] = {
            "id": s["Id"],
            "name": name,
            "school": s["School"],
            "club": clubs.get(s["Club"], s["Club"]),
            "family": family,
            "familyRuby": ruby,
            "npc": False,
            "answers": answers,
            "fullAnswers": full,
            "_sort": (s["Club"] == "EmptyClub", clubs.get(s["Club"], s["Club"]), s["Id"]),
        }

    implemented = {(p["family"], p["name"]) for p in people.values()}
    npc_id = 900000
    for n in npc_data["students"]:
        if (n["family"], n["name"]) in implemented:
            print(f"実装済みのため除外: {n['family']}{n['name']}")
            continue
        npc_id += 1
        answers, full = make_answers(n["name"], n["family"], n["familyRuby"], n.get("alias", []))
        people[f"npc:{n['family']}{n['name']}"] = {
            "id": npc_id,
            "name": n["name"],
            "school": n["school"],
            "club": n["club"],
            "family": n["family"],
            "familyRuby": (n["familyRuby"] or [""])[0],
            "npc": True,
            "answers": answers,
            "fullAnswers": full,
            "_sort": (True, n["club"], npc_id),
        }

    order_keys = list(SCHOOL_ORDER)
    extra = {s["key"]: s for s in npc_data["schools"]}
    for s in npc_data["schools"]:
        if s["before"] in order_keys:
            order_keys.insert(order_keys.index(s["before"]), s["key"])
        else:
            order_keys.append(s["key"])
    order = {k: i for i, k in enumerate(order_keys)}

    lst = sorted(people.values(), key=lambda p: (order.get(p["school"], 99), p["_sort"]))
    for p in lst:
        del p["_sort"]

    schools = []
    for k in order_keys:
        if not any(p["school"] == k for p in lst):
            continue
        if k in extra:
            schools.append({"key": k, "name": extra[k]["name"], "long": extra[k]["long"]})
        else:
            schools.append({"key": k, "name": loc["School"][k], "long": loc["SchoolLong"][k]})

    data = {"schools": schools, "students": lst}
    OUT.write_text(
        "// 自動生成: tools/build_students.py（データ出典: SchaleDB / data/npcs.json）\n"
        "window.BA_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    sys.stdout.reconfigure(encoding="utf-8")
    normal = [p for p in lst if not p["npc"]]
    print(f"実装済み {len(normal)} 人 / NPC込み {len(lst)} 人 / {len(schools)} 校 -> {OUT}")
    for s in schools:
        a = sum(1 for p in normal if p["school"] == s["key"])
        b = sum(1 for p in lst if p["school"] == s["key"])
        print(f"  {s['name']}: {a} / {b}")


if __name__ == "__main__":
    main()
