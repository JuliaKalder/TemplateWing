/**
 * Shared UI helpers with no messenger.* dependency.
 */

/**
 * Filters a list of template elements by the current search input and category filter.
 * @param {string} itemSelector - CSS selector for the template items to filter.
 */
export function filterTemplateList(itemSelector) {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const selectedCategory = document.getElementById("category-filter").value.toLowerCase();
  for (const item of document.querySelectorAll(itemSelector)) {
    const matchesSearch =
      !query || item.dataset.name.includes(query) || item.dataset.subject.includes(query);
    const matchesCategory = !selectedCategory || item.dataset.category === selectedCategory;
    item.hidden = !(matchesSearch && matchesCategory);
  }
}
