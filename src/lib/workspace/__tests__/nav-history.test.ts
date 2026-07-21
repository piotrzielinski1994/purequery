import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  currentEntry,
  EMPTY_NAV,
  goBack,
  goForward,
  type NavEntry,
  pushNavigation,
} from "@/lib/workspace/nav-history";

const orders: NavEntry = { tableId: "db::public::orders", filter: "" };
const customers: NavEntry = {
  tableId: "db::public::customers",
  filter: `"id" = '42'`,
};
const products: NavEntry = {
  tableId: "db::public::products",
  filter: `"id" = '3'`,
};

describe("nav-history", () => {
  it("should seed both the source and the target on the first navigation", () => {
    const state = pushNavigation(EMPTY_NAV, orders, customers);
    expect(state.entries).toEqual([orders, customers]);
    expect(state.index).toBe(1);
    expect(currentEntry(state)).toEqual(customers);
  });

  it("should allow going back to the source after a navigation", () => {
    const state = pushNavigation(EMPTY_NAV, orders, customers);
    expect(canGoBack(state)).toBe(true);
    expect(canGoForward(state)).toBe(false);
    const back = goBack(state);
    expect(currentEntry(back)).toEqual(orders);
    expect(canGoForward(back)).toBe(true);
  });

  it("should go forward again to the target after going back", () => {
    const state = goForward(
      goBack(pushNavigation(EMPTY_NAV, orders, customers)),
    );
    expect(currentEntry(state)).toEqual(customers);
    expect(canGoForward(state)).toBe(false);
  });

  it("should not go back past the first entry", () => {
    const state = pushNavigation(EMPTY_NAV, orders, customers);
    const twiceBack = goBack(goBack(state));
    expect(currentEntry(twiceBack)).toEqual(orders);
    expect(canGoBack(twiceBack)).toBe(false);
  });

  it("should not go forward past the last entry", () => {
    const state = pushNavigation(EMPTY_NAV, orders, customers);
    expect(goForward(state)).toEqual(state);
  });

  it("should append onto the existing chain when navigating from the current target", () => {
    const first = pushNavigation(EMPTY_NAV, orders, customers);
    const second = pushNavigation(first, customers, products);
    expect(second.entries).toEqual([orders, customers, products]);
    expect(second.index).toBe(2);
  });

  it("should drop the forward history when navigating after going back", () => {
    const first = pushNavigation(EMPTY_NAV, orders, customers);
    const back = goBack(first);
    const branched = pushNavigation(back, orders, products);
    expect(branched.entries).toEqual([orders, products]);
    expect(branched.index).toBe(1);
    expect(canGoForward(branched)).toBe(false);
  });

  it("should be a no-op when re-navigating to the current position", () => {
    const first = pushNavigation(EMPTY_NAV, orders, customers);
    const again = pushNavigation(first, orders, customers);
    expect(again).toEqual(first);
  });

  it("should track separate targets that share a table with different filters", () => {
    const a = pushNavigation(EMPTY_NAV, orders, customers);
    const other = { tableId: customers.tableId, filter: `"id" = '99'` };
    const b = pushNavigation(a, customers, other);
    expect(b.entries).toEqual([orders, customers, other]);
    expect(b.index).toBe(2);
  });
});
