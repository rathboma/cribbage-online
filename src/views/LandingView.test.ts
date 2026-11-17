import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '@/App.vue'
import { routes } from '@/router/routes'

async function mountApp(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const wrapper = mount(App, { global: { plugins: [router, createPinia()] } })
  await flushPromises()
  return { wrapper, router }
}

describe('landing page', () => {
  it('shows the name, the pitch and exactly two actions', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.get('h1').text()).toBe('Cribbage')
    expect(wrapper.text()).toContain('Play cribbage with a friend. No signup.')
    const actions = wrapper.findAll('nav a')
    expect(actions.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['Start game', '/new'],
      ['Join game', '/join'],
    ])
  })

  it.each([
    ['Start game', '/new', 'new-game'],
    ['Join game', '/join', 'join'],
  ])('%s goes to %s', async (label, path, name) => {
    const { wrapper, router } = await mountApp()
    const link = wrapper.findAll('nav a').find((a) => a.text() === label)!
    await link.trigger('click')
    // The target view is loaded lazily, so the navigation finishes a little later.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(path))
    expect(router.currentRoute.value.name).toBe(name)
  })

  it('shows a not-found page with a way home', async () => {
    const { wrapper } = await mountApp('/no/such/page')
    expect(wrapper.get('h1').text()).toBe('Page not found')
    expect(wrapper.get('a[href="/"]').text()).toContain('start page')
  })
})
