"""SchaleDB から生徒データを取得し data/students.js を生成する。

使い方: py tools/build_students.py
衣装違い（「アル（正月）」など）は同一人物としてまとめる。
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://schaledb.com/data/jp/"
OUT = Path(__file__).resolve().parent.parent / "data" / "students.js"

# 学校の表示順。コラボ枠はまとめて「コラボ」にする
SCHOOL_ORDER = [
    "Abydos", "Gehenna", "Trinity", "Millennium", "Hyakkiyako", "Shanhaijing",
    "RedWinter", "Valkyrie", "SRT", "Arius", "Highlander", "WildHunt", "Odyssey",
]
COLLAB = {"ETC", "Tokiwadai", "Sakugawa", "Other"}

# 別名扱いで同一人物にまとめるもの
MERGE = {"シロコ＊テラー": "シロコ"}


def fetch(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "ba-ierukana-builder"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def to_hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def base_name(name):
    n = re.sub(r"[（(].*?[）)]", "", name).strip()
    return MERGE.get(n, n)


def main():
    students = fetch("students.min.json")
    loc = fetch("localization.min.json")
    clubs = loc["Club"]

    people = {}
    for s in sorted(students.values(), key=lambda x: x["Id"]):
        if not s["IsReleased"][0]:
            continue
        name = base_name(s["Name"])
        if name in people:
            continue
        school = "Collab" if s["School"] in COLLAB else s["School"]
        family = s["FamilyName"].strip()
        personal = s["PersonalName"].strip()
        people[name] = {
            "id": s["Id"],
            "name": name,
            "school": school,
            "club": clubs.get(s["Club"], s["Club"]),
            "clubKey": s["Club"],
            "family": family,
            "familyRuby": s["FamilyNameRuby"].strip(),
            "personal": personal,
            "personalRuby": s["PersonalNameRuby"].strip(),
        }

    # 回答として受け付ける文字列（ひらがな化して比較する）
    answer_owner = {}
    for p in people.values():
        cands = {p["name"], p["personal"]}
        if p["family"]:
            cands.add(p["family"] + p["personal"])
        if p["familyRuby"]:
            cands.add(p["familyRuby"] + (p["personalRuby"] or p["personal"]))
        if p["personalRuby"]:
            cands.add(p["personalRuby"])
        p["answers"] = sorted({to_hira(c) for c in cands if c})
        for a in p["answers"]:
            answer_owner.setdefault(a, []).append(p["name"])

    # 複数の生徒にかぶる別名は除外する（名前そのものは必ず残す）
    for p in people.values():
        own = to_hira(p["name"])
        p["answers"] = [a for a in p["answers"] if a == own or len(answer_owner[a]) == 1]

    order = {k: i for i, k in enumerate(SCHOOL_ORDER + ["Collab"])}
    lst = sorted(people.values(), key=lambda p: (order.get(p["school"], 99), p["clubKey"] == "EmptyClub", p["club"], p["id"]))
    for p in lst:
        del p["clubKey"]

    schools = [
        {"key": k, "name": loc["School"].get(k, "コラボ") if k != "Collab" else "コラボ",
         "long": loc["SchoolLong"].get(k, "コラボ") if k != "Collab" else "コラボ"}
        for k in SCHOOL_ORDER + ["Collab"]
        if any(p["school"] == k for p in lst)
    ]

    data = {"schools": schools, "students": lst}
    OUT.write_text(
        "// 自動生成: tools/build_students.py（データ出典: SchaleDB）\n"
        "window.BA_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{len(lst)} 人 / {len(schools)} 校 -> {OUT}")
    for s in schools:
        print(s["name"], sum(1 for p in lst if p["school"] == s["key"]))


if __name__ == "__main__":
    main()
