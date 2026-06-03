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

/**
 * Populate a <select> filter element with category options, replacing any
 * previously rendered ones (first/placeholder option is preserved).
 *
 * @param {string} filterId  - id of the <select> element
 * @param {string[]} categories - sorted list of category values to render
 */
export function setFilterOptions(filterId, categories) {
  const filter = document.getElementById(filterId);
  const options = filter.querySelectorAll("option:not(:first-child)");
  options.forEach((opt) => opt.remove());
  for (const cat of categories) {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    filter.appendChild(option);
  }
}
