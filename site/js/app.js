/* Daily Research Digest - Main Application */

const App = {
  config: {
    owner: '', // Set by build script
    repo: '',  // Set by build script
    branch: 'main',
    favoritesFile: 'favorites.json'
  },

  // Initialize config from data attributes
  init() {
    const body = document.body;
    this.config.owner = body.dataset.owner || '';
    this.config.repo = body.dataset.repo || '';
  }
};

/* GitHub API */
const GitHub = {
  getToken() {
    return localStorage.getItem('github_pat') || '';
  },

  setToken(token) {
    localStorage.setItem('github_pat', token);
  },

  hasToken() {
    return !!this.getToken();
  },

  async getFile(path) {
    const { owner, repo, branch } = App.config;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json();
    const content = atob(data.content);
    return { content: JSON.parse(content), sha: data.sha };
  },

  async putFile(path, content, sha, message) {
    const { owner, repo, branch } = App.config;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const token = this.getToken();
    if (!token) throw new Error('No GitHub token configured');

    const body = {
      message,
      content: btoa(JSON.stringify(content, null, 2)),
      branch
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `GitHub API error: ${res.status}`);
    }

    return res.json();
  },

  async triggerWorkflow(workflowId, inputs = {}) {
    const { owner, repo, branch } = App.config;
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;

    const token = this.getToken();
    if (!token) throw new Error('No GitHub token configured');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: branch,
        inputs
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error: ${res.status}`);
    }

    return true;
  }
};

/* Favorites Management */
const Favorites = {
  data: { papers: [] },
  sha: null,

  async load() {
    try {
      const result = await GitHub.getFile(App.config.favoritesFile);
      if (result) {
        this.data = result.content;
        this.sha = result.sha;
      }
    } catch (e) {
      console.error('Failed to load favorites:', e);
    }
    return this.data;
  },

  async save(message) {
    const result = await GitHub.putFile(
      App.config.favoritesFile,
      this.data,
      this.sha,
      message
    );
    this.sha = result.content.sha;
  },

  getAll() {
    return this.data.papers || [];
  },

  has(arxivId) {
    return this.getAll().some(p => p.arxiv_id === arxivId);
  },

  async add(paper, note = '') {
    if (this.has(paper.arxiv_id)) return false;

    this.data.papers.push({
      arxiv_id: paper.arxiv_id,
      title: paper.title,
      link: paper.link,
      authors: paper.authors,
      relevance_score: paper.relevance_score,
      user_note: note,
      saved_at: new Date().toISOString()
    });

    await this.save(`Add favorite: ${paper.title.substring(0, 50)}`);
    return true;
  },

  async remove(arxivId) {
    const paper = this.getAll().find(p => p.arxiv_id === arxivId);
    this.data.papers = this.getAll().filter(p => p.arxiv_id !== arxivId);
    await this.save(`Remove favorite: ${paper?.title?.substring(0, 50) || arxivId}`);
  },

  async updateNote(arxivId, note) {
    const paper = this.getAll().find(p => p.arxiv_id === arxivId);
    if (paper) {
      paper.user_note = note;
      await this.save(`Update note: ${paper.title.substring(0, 50)}`);
    }
  }
};

/* Digest Loading */
const Digests = {
  async loadList() {
    try {
      const res = await fetch('digests/index.json');
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },

  async loadDigest(date) {
    const res = await fetch(`digests/${date}.json`);
    if (!res.ok) throw new Error('Digest not found');
    return res.json();
  }
};

/* UI Helpers */
const UI = {
  getScoreClass(score) {
    if (score >= 8) return 'high';
    if (score >= 6) return 'medium';
    if (score >= 4) return 'low';
    return 'none';
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  },

  showStatus(container, message, type = 'info') {
    const status = document.createElement('div');
    status.className = `status ${type}`;
    status.textContent = message;
    container.prepend(status);
    setTimeout(() => status.remove(), 3000);
  },

  renderPaperCard(paper, options = {}) {
    const { showSaveButton = true, showRemoveButton = false, showEditNote = false } = options;
    const scoreClass = this.getScoreClass(paper.relevance_score);
    const isSaved = Favorites.has(paper.arxiv_id);

    const authors = paper.authors?.slice(0, 3).join(', ') || '';
    const moreAuthors = paper.authors?.length > 3 ? ` +${paper.authors.length - 3} more` : '';

    let actionsHtml = '';
    if (showSaveButton && !isSaved) {
      actionsHtml += `<button class="btn btn-primary save-btn" data-arxiv="${paper.arxiv_id}">Save</button>`;
    } else if (showSaveButton && isSaved) {
      actionsHtml += `<span style="color: #28a745; font-size: 13px;">Saved</span>`;
    }
    if (showRemoveButton) {
      actionsHtml += `<button class="btn btn-danger remove-btn" data-arxiv="${paper.arxiv_id}">Remove</button>`;
    }
    if (showEditNote) {
      actionsHtml += `<button class="btn btn-secondary edit-note-btn" data-arxiv="${paper.arxiv_id}">Edit Note</button>`;
    }

    let noteHtml = '';
    if (paper.user_note) {
      noteHtml = `<div class="user-note"><strong>Note:</strong> ${this.escapeHtml(paper.user_note)}</div>`;
    }

    return `
      <div class="paper-card score-${scoreClass}" data-arxiv="${paper.arxiv_id}">
        <span class="score-badge ${scoreClass}">${paper.relevance_score?.toFixed(1) || '?'}/10</span>
        <h3><a href="${paper.link}" target="_blank">${this.escapeHtml(paper.title)}</a></h3>
        <p class="authors">${this.escapeHtml(authors)}${moreAuthors}</p>
        ${paper.relevance_reason ? `<p class="reason">${this.escapeHtml(paper.relevance_reason)}</p>` : ''}
        ${noteHtml}
        <div class="actions">${actionsHtml}</div>
      </div>
    `;
  }
};

/* Page Controllers */
const Pages = {
  // Index page
  async initIndex() {
    const container = document.getElementById('digest-list');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading digests...</div>';

    const digests = await Digests.loadList();

    if (digests.length === 0) {
      container.innerHTML = '<div class="empty-state">No digests available yet.</div>';
      return;
    }

    container.innerHTML = digests.map(d => `
      <div class="digest-item">
        <h3><a href="digest.html?date=${d.date}">${UI.formatDate(d.date)}</a></h3>
        <p class="meta">${d.paper_count} papers</p>
      </div>
    `).join('');
  },

  // Digest page
  async initDigest() {
    const container = document.getElementById('papers-container');
    const titleEl = document.getElementById('digest-title');
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const date = params.get('date');

    if (!date) {
      container.innerHTML = '<div class="empty-state">No date specified.</div>';
      return;
    }

    titleEl.textContent = UI.formatDate(date);
    container.innerHTML = '<div class="loading">Loading papers...</div>';

    try {
      await Favorites.load();
      const digest = await Digests.loadDigest(date);

      if (!digest.papers?.length) {
        container.innerHTML = '<div class="empty-state">No papers in this digest.</div>';
        return;
      }

      container.innerHTML = digest.papers.map(p => UI.renderPaperCard(p, { showSaveButton: true })).join('');

      // Event listeners for save buttons
      container.querySelectorAll('.save-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const arxivId = e.target.dataset.arxiv;
          const paper = digest.papers.find(p => p.arxiv_id === arxivId);

          if (!GitHub.hasToken()) {
            alert('Please configure your GitHub token on the Favorites page first.');
            return;
          }

          const note = prompt('Add a note (optional):') || '';
          btn.disabled = true;
          btn.textContent = 'Saving...';

          try {
            await Favorites.add(paper, note);
            btn.outerHTML = '<span style="color: #28a745; font-size: 13px;">Saved</span>';
          } catch (err) {
            alert('Failed to save: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Save';
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="status error">Failed to load digest: ${err.message}</div>`;
    }
  },

  // Favorites page
  async initFavorites() {
    const container = document.getElementById('favorites-container');
    const tokenInput = document.getElementById('github-token');
    const saveTokenBtn = document.getElementById('save-token');
    const tokenStatus = document.getElementById('token-status');

    if (!container) return;

    // Token management
    if (tokenInput && GitHub.hasToken()) {
      tokenInput.value = '********';
      tokenStatus.textContent = 'Token configured';
      tokenStatus.className = 'status success';
    }

    saveTokenBtn?.addEventListener('click', () => {
      const token = tokenInput.value;
      if (token && token !== '********') {
        GitHub.setToken(token);
        tokenInput.value = '********';
        tokenStatus.textContent = 'Token saved';
        tokenStatus.className = 'status success';
        this.loadFavorites(container);
      }
    });

    // Regenerate digest functionality
    const categoriesInput = document.getElementById('digest-categories');
    const interestsInput = document.getElementById('digest-interests');
    const regenerateBtn = document.getElementById('regenerate-digest');
    const regenerateStatus = document.getElementById('regenerate-status');

    // Load saved settings
    const savedCategories = localStorage.getItem('digest_categories');
    const savedInterests = localStorage.getItem('digest_interests');
    if (savedCategories) categoriesInput.value = savedCategories;
    if (savedInterests) interestsInput.value = savedInterests;

    regenerateBtn?.addEventListener('click', async () => {
      if (!GitHub.hasToken()) {
        regenerateStatus.textContent = 'Please configure your GitHub token first.';
        regenerateStatus.className = 'status error';
        return;
      }

      const categories = categoriesInput.value.trim();
      const interests = interestsInput.value.trim();

      if (!categories) {
        regenerateStatus.textContent = 'Please enter at least one category.';
        regenerateStatus.className = 'status error';
        return;
      }

      // Save settings
      localStorage.setItem('digest_categories', categories);
      localStorage.setItem('digest_interests', interests);

      regenerateBtn.disabled = true;
      regenerateBtn.textContent = 'Triggering...';
      regenerateStatus.textContent = '';

      try {
        await GitHub.triggerWorkflow('digest.yml', {
          categories: categories,
          interests: interests
        });
        regenerateStatus.textContent = 'Digest regeneration triggered! Check GitHub Actions for progress.';
        regenerateStatus.className = 'status success';
      } catch (err) {
        regenerateStatus.textContent = 'Failed: ' + err.message;
        regenerateStatus.className = 'status error';
      } finally {
        regenerateBtn.disabled = false;
        regenerateBtn.textContent = 'Regenerate Digest';
      }
    });

    // Load favorites
    await this.loadFavorites(container);
  },

  async loadFavorites(container) {
    container.innerHTML = '<div class="loading">Loading favorites...</div>';

    try {
      await Favorites.load();
      const papers = Favorites.getAll();

      if (papers.length === 0) {
        container.innerHTML = '<div class="empty-state">No favorites saved yet. Browse digests and save papers you like.</div>';
        return;
      }

      container.innerHTML = papers.map(p => UI.renderPaperCard(p, {
        showSaveButton: false,
        showRemoveButton: true,
        showEditNote: true
      })).join('');

      // Remove button listeners
      container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          if (!confirm('Remove this paper from favorites?')) return;

          const arxivId = e.target.dataset.arxiv;
          btn.disabled = true;
          btn.textContent = 'Removing...';

          try {
            await Favorites.remove(arxivId);
            btn.closest('.paper-card').remove();

            if (Favorites.getAll().length === 0) {
              container.innerHTML = '<div class="empty-state">No favorites saved yet.</div>';
            }
          } catch (err) {
            alert('Failed to remove: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Remove';
          }
        });
      });

      // Edit note listeners
      container.querySelectorAll('.edit-note-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const arxivId = e.target.dataset.arxiv;
          const paper = Favorites.getAll().find(p => p.arxiv_id === arxivId);
          const note = prompt('Edit note:', paper?.user_note || '');

          if (note === null) return; // Cancelled

          btn.disabled = true;
          btn.textContent = 'Saving...';

          try {
            await Favorites.updateNote(arxivId, note);
            const card = btn.closest('.paper-card');
            let noteEl = card.querySelector('.user-note');

            if (note) {
              if (noteEl) {
                noteEl.innerHTML = `<strong>Note:</strong> ${UI.escapeHtml(note)}`;
              } else {
                const actions = card.querySelector('.actions');
                actions.insertAdjacentHTML('beforebegin', `<div class="user-note"><strong>Note:</strong> ${UI.escapeHtml(note)}</div>`);
              }
            } else if (noteEl) {
              noteEl.remove();
            }

            btn.disabled = false;
            btn.textContent = 'Edit Note';
          } catch (err) {
            alert('Failed to update note: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Edit Note';
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="status error">Failed to load favorites: ${err.message}</div>`;
    }
  }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // Determine which page we're on and initialize
  if (document.getElementById('digest-list')) {
    Pages.initIndex();
  } else if (document.getElementById('papers-container')) {
    Pages.initDigest();
  } else if (document.getElementById('favorites-container')) {
    Pages.initFavorites();
  }
});
