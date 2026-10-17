import assert from "node:assert/strict";
import test from "node:test";
import { TeacherPhotos } from "../src/schedule/teacher-photos.js";

function directory(names: string[]) {
  const imageRequests: string[] = [];
  const photos = new TeacherPhotos((async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("searchuser")) {
      return new Response(names.map((name, index) =>
        `<div><img src="/${index}.jpg"></div><a href="/teacher">${name}<p>Доцент</p></a>`).join(""));
    }
    imageRequests.push(url);
    return new Response(url);
  }) as typeof fetch);
  return { photos, imageRequests };
}

test("teacher photos distinguish shared surnames using initials and ignore titles", async () => {
  const { photos } = directory(["Бойко Ольга Вікторівна", "Бойко Лев Степанович"]);
  for (const name of ["Бойко Л. С. Доцент", "Бойко Л.С.", "Бойко Л. С.", "Бойко Л С", "Бойко Лев Степанович Професор"]) {
    assert.equal((await photos.find(name))?.toString(), "https://rating2.lntu.edu.ua/1.jpg");
  }
  assert.equal((await photos.find("Бойко О.В. Доцент"))?.toString(), "https://rating2.lntu.edu.ua/0.jpg");
});

test("ambiguous or conflicting names never fall back to the first surname photo", async () => {
  const { photos, imageRequests } = directory(["Бойко Лев Степанович", "Бойко Леонід Сергійович"]);
  for (const name of ["Бойко", "Бойко Л. С. Доцент", "Бойко О. В.", "Бойко Любомир Степанович"]) {
    assert.equal(await photos.find(name), undefined);
  }
  assert.deepEqual(imageRequests, []);
  assert.equal((await photos.find("Бойко Лев Степанович"))?.toString(), "https://rating2.lntu.edu.ua/0.jpg");
});

test("surname-only lookup works only for a unique exact surname", async () => {
  const { photos } = directory(["Бойко Лев Степанович", "Бойкова Ольга Вікторівна"]);
  assert.equal((await photos.find("Бойко"))?.toString(), "https://rating2.lntu.edu.ua/0.jpg");
  assert.equal(await photos.find("Бойко О. В."), undefined);
  assert.equal(await photos.find(undefined), undefined);
});
