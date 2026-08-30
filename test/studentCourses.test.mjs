import { test } from "node:test";
import assert from "node:assert/strict";
import { mapEnrolledCourseRows } from "../src/platform/studentCoursesApi.js";

test("mapEnrolledCourseRows: deduplica y ordena por fecha", () => {
  const rows = [
    {
      course_id: "c1",
      courses: {
        id: "c1",
        title: "Robótica",
        slug: "robotica",
        created_at: "2026-01-02T00:00:00Z",
        org_id: "o1",
        organizations: { id: "o1", name: "San Andrés", slug: "st-andrew" },
      },
    },
    {
      course_id: "c1",
      courses: {
        id: "c1",
        title: "Robótica",
        slug: "robotica",
        created_at: "2026-01-02T00:00:00Z",
        org_id: "o1",
        organizations: { id: "o1", name: "San Andrés", slug: "st-andrew" },
      },
    },
    {
      course_id: "c2",
      courses: {
        id: "c2",
        title: "Y8 IT",
        slug: "y8-it",
        created_at: "2026-02-01T00:00:00Z",
        org_id: "o1",
        organizations: { id: "o1", name: "San Andrés", slug: "st-andrew" },
      },
    },
  ];

  const courses = mapEnrolledCourseRows(rows);
  assert.equal(courses.length, 2);
  assert.equal(courses[0].id, "c2");
  assert.equal(courses[1].id, "c1");
  assert.equal(courses[0].orgName, "San Andrés");
});

test("mapEnrolledCourseRows: ignora filas sin curso", () => {
  assert.deepEqual(mapEnrolledCourseRows([{ course_id: "x", courses: null }]), []);
});
