"use client";

import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useParams } from "next/navigation";
import { useMemo } from "react";

import { api } from "./api";
import type { Category, CourseDetail, CourseProgress, MyCourse } from "./types";

/** Tham số số nguyên trên URL, vd /courses/[id] -> useNumberParam("id"). */
export function useNumberParam(name: string): number {
  const params = useParams<Record<string, string>>();
  return Number(params[name]);
}

export function useCategories() {
  const query = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<Category[]>("/categories")).data,
    staleTime: 60_000,
  });
  const byId = useMemo(() => new Map((query.data ?? []).map((c) => [c.id, c])), [query.data]);
  return { ...query, categories: query.data ?? [], byId };
}

export function useCourse(id: number) {
  return useQuery({
    queryKey: ["courses", id],
    queryFn: async () => (await api.get<CourseDetail>(`/courses/${id}`)).data,
    enabled: id > 0,
  });
}

export function useMyCourses() {
  return useQuery({
    queryKey: ["my-courses", ""],
    queryFn: async () => (await api.get<MyCourse[]>("/me/courses")).data,
  });
}

/** Tiến độ của tôi trong khoá học; null = chưa ghi danh (không gọi API khi chưa ghi danh để tránh 404). */
export function useMyProgress(courseId: number, enabled = true) {
  const mine = useMyCourses();
  const enrolled = !!mine.data?.some((e) => e.course_id === courseId);
  const query = useQuery({
    queryKey: ["my-progress", courseId],
    queryFn: async () => {
      try {
        return (await api.get<CourseProgress>(`/me/courses/${courseId}/progress`)).data;
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: courseId > 0 && enabled && enrolled,
  });
  if (mine.isPending) return { data: undefined, isPending: true } as const;
  if (!enrolled) return { data: null, isPending: false } as const;
  return { data: query.data, isPending: query.isPending } as const;
}
