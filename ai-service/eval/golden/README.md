# Golden set — how to build one (Roman Urdu + English)

Golden set = asli copies jo **do teachers ne alag alag** check ki hon. Har prompt ya model change se pehle
`python -m eval.run_eval --gate` chalayein; agar AI teachers se kam match kare to change school tak na jaye.

**Kitni copies:** 200–500 answers (taqreeban 60–150 copies). Mix rakhein:
- classes (5, 8, 9, 10), subjects (Maths, Physics, English, Urdu baad mein);
- handwriting saaf / average / kharab, blank answers, aur kuch dhundhli photos.

## Folder

```
eval/golden/<set-name>/
  golden.json
  copies/<copy-id>-1.jpg, <copy-id>-2.jpg ...
```

## golden.json

```json
{
  "name": "Al-Noor pilot, Oct 2026",
  "tests": [
    {
      "questions": [
        {"number": 1, "text": "Define speed.", "max_marks": 2, "type": "theory",
         "answer_key": "distance per unit time", "rules": [{"id": "R1", "text": "any wording"}]},
        {"number": 2, "text": "150/12 = ?", "max_marks": 3, "type": "numeric", "final_answer": "12.5 m/s"}
      ],
      "copies": [
        {"id": "9A-03", "pages": ["copies/9A-03-1.jpg"], "subject": "Physics", "class_name": "Class 9",
         "language": "en", "group": {"handwriting": "messy"},
         "marks": {"teacher_a": {"1": 2, "2": 1.5}, "teacher_b": {"1": 2, "2": 2}}}
      ]
    }
  ]
}
```

- `teacher_a` = the reference. `teacher_b` (optional) shows the human ceiling ("teachers vs each other QWK").
- Keep names out of the photos or crop the top band; the golden set is student data — store it privately.

## Model bake-off

```
python -m eval.run_eval --golden eval/golden/<set>/golden.json --repeats 3 \
  --models openai:gpt-5-mini,openai:gpt-5-nano,gemini:gemini-3.1-flash-lite
```

Pick the cheapest model whose QWK is within ~0.03 of the best and whose bias is small. Put it in
`ai-service/.env` as `OPENAI_MODEL` (or `CHEAP_MODEL` for MCQ/numeric-only tests).
