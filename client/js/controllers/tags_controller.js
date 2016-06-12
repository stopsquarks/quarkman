'use strict';

const router = require('../router.js');
const api = require('../api.js');
const tags = require('../tags.js');
const events = require('../events.js');
const misc = require('../util/misc.js');
const topNavController = require('../controllers/top_nav_controller.js');
const pageController = require('../controllers/page_controller.js');
const TagView = require('../views/tag_view.js');
const TagsHeaderView = require('../views/tags_header_view.js');
const TagsPageView = require('../views/tags_page_view.js');
const TagCategoriesView = require('../views/tag_categories_view.js');
const EmptyView = require('../views/empty_view.js');

class TagsController {
    constructor() {
        this._tagView = new TagView();
        this._tagsHeaderView = new TagsHeaderView();
        this._tagsPageView = new TagsPageView();
        this._tagCategoriesView = new TagCategoriesView();
        this._emptyView = new EmptyView();
    }

    registerRoutes() {
        router.enter(
            '/tag-categories',
            (ctx, next) => { this._tagCategoriesRoute(ctx, next); });
        router.enter(
            '/tag/:name',
            (ctx, next) => { this._loadTagRoute(ctx, next); },
            (ctx, next) => { this._showTagRoute(ctx, next); });
        router.enter(
            '/tag/:name/merge',
            (ctx, next) => { this._loadTagRoute(ctx, next); },
            (ctx, next) => { this._mergeTagRoute(ctx, next); });
        router.enter(
            '/tag/:name/delete',
            (ctx, next) => { this._loadTagRoute(ctx, next); },
            (ctx, next) => { this._deleteTagRoute(ctx, next); });
        router.enter(
            '/tags/:query?',
            (ctx, next) => { misc.parseSearchQueryRoute(ctx, next); },
            (ctx, next) => { this._listTagsRoute(ctx, next); });
    }

    _saveTagCategories(
            addedCategories,
            changedCategories,
            removedCategories,
            defaultCategory) {
        let promises = [];
        for (let category of addedCategories) {
            promises.push(api.post('/tag-categories/', category));
        }
        for (let category of changedCategories) {
            promises.push(
                api.put('/tag-category/' + category.originalName, category));
        }
        for (let name of removedCategories) {
            promises.push(api.delete('/tag-category/' + name));
        }
        Promise.all(promises)
            .then(
                () => {
                    if (!defaultCategory) {
                        return Promise.resolve();
                    }
                    return api.put(
                        '/tag-category/' + defaultCategory + '/default');
                }, response => {
                    return Promise.reject(response);
                })
            .then(
                () => {
                    events.notify(events.TagsChange);
                    events.notify(events.Success, 'Changes saved.');
                },
                response => {
                    events.notify(events.Error, response.description);
                });
    }

    _loadTagRoute(ctx, next) {
        if (ctx.state.tag) {
            next();
        } else if (this._cachedTag &&
                this._cachedTag.names == ctx.params.names) {
            ctx.state.tag = this._cachedTag;
            next();
        } else {
            api.get('/tag/' + ctx.params.name).then(response => {
                ctx.state.tag = response;
                ctx.save();
                this._cachedTag = response;
                next();
            }, response => {
                this._emptyView.render();
                events.notify(events.Error, response.description);
            });
        }
    }

    _showTagRoute(ctx, next) {
        this._show(ctx.state.tag, 'summary');
    }

    _mergeTagRoute(ctx, next) {
        this._show(ctx.state.tag, 'merge');
    }

    _deleteTagRoute(ctx, next) {
        this._show(ctx.state.tag, 'delete');
    }

    _show(tag, section) {
        topNavController.activate('tags');
        const categories = {};
        for (let category of tags.getAllCategories()) {
            categories[category.name] = category.name;
        }
        this._tagView.render({
            tag: tag,
            section: section,
            canEditNames: api.hasPrivilege('tags:edit:names'),
            canEditCategory: api.hasPrivilege('tags:edit:category'),
            canEditImplications: api.hasPrivilege('tags:edit:implications'),
            canEditSuggestions: api.hasPrivilege('tags:edit:suggestions'),
            canMerge: api.hasPrivilege('tags:delete'),
            canDelete: api.hasPrivilege('tags:merge'),
            categories: categories,
            save: (...args) => { return this._saveTag(tag, ...args); },
            mergeTo: (...args) => { return this._mergeTag(tag, ...args); },
            delete: (...args) => { return this._deleteTag(tag, ...args); },
        });
    }

    _saveTag(tag, input) {
        return api.put('/tag/' + tag.names[0], input).then(response => {
            if (input.names && input.names[0] !== tag.names[0]) {
                router.show('/tag/' + input.names[0]);
            }
            events.notify(events.Success, 'Tag saved.');
            return Promise.resolve();
        }, response => {
            events.notify(events.Error, response.description);
            return Promise.reject();
        });
    }

    _mergeTag(tag, targetTagName) {
        return api.post(
            '/tag-merge/',
            {remove: tag.names[0], mergeTo: targetTagName}
        ).then(response => {
            router.show('/tag/' + targetTagName + '/merge');
            events.notify(events.Success, 'Tag merged.');
            return Promise.resolve();
        }, response => {
            events.notify(events.Error, response.description);
            return Promise.reject();
        });
    }

    _deleteTag(tag) {
        return api.delete('/tag/' + tag.names[0]).then(response => {
            router.show('/tags/');
            events.notify(events.Success, 'Tag deleted.');
            return Promise.resolve();
        }, response => {
            events.notify(events.Error, response.description);
            return Promise.reject();
        });
    }

    _tagCategoriesRoute(ctx, next) {
        topNavController.activate('tags');
        api.get('/tag-categories/').then(response => {
            this._tagCategoriesView.render({
                tagCategories: response.results,
                canEditName: api.hasPrivilege('tagCategories:edit:name'),
                canEditColor: api.hasPrivilege('tagCategories:edit:color'),
                canDelete: api.hasPrivilege('tagCategories:delete'),
                canCreate: api.hasPrivilege('tagCategories:create'),
                canSetDefault: api.hasPrivilege('tagCategories:setDefault'),
                saveChanges: (...args) => {
                    return this._saveTagCategories(...args);
                },
                getCategories: () => {
                    return api.get('/tag-categories/').then(response => {
                        return Promise.resolve(response.results);
                    }, response => {
                        return Promise.reject(response);
                    });
                }
            });
        }, response => {
            this._emptyView.render();
            events.notify(events.Error, response.description);
        });
    }

    _listTagsRoute(ctx, next) {
        topNavController.activate('tags');

        pageController.run({
            searchQuery: ctx.searchQuery,
            clientUrl: '/tags/' + misc.formatSearchQuery({
                text: ctx.searchQuery.text, page: '{page}'}),
            requestPage: pageController.createHistoryCacheProxy(
                ctx,
                page => {
                    const text = ctx.searchQuery.text;
                    return api.get(
                        `/tags/?query=${text}&page=${page}&pageSize=50` +
                        '&fields=names,suggestions,implications,' +
                        'lastEditTime,usages');
                }),
            headerRenderer: this._tagsHeaderView,
            pageRenderer: this._tagsPageView,
            headerContext: {
                canEditTagCategories: api.hasPrivilege('tagCategories:edit'),
            },
        });
    }
}

module.exports = new TagsController();
